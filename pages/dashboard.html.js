// pages/dashboard.html.js
import { state, set } from "../core/store.js";
import { makePool, drawPool } from "../modules/panel-pool.js";
import { makeFloor } from "../modules/panel-floor.js";
import {
  subscribeActiveAssignments,
  subscribeWorkers,
  getAssignmentsByDate,
  subscribeAreas,
  DEFAULT_AREAS
} from "../api/firebase.js";
import { toast } from "../core/ui.js";

export function renderDashboard(mount) {
  const todayStr = new Date().toISOString().slice(0, 10);
  let selectedDate = state.assignmentDate || todayStr;
  let isReadOnly = selectedDate !== todayStr;
  const wrap = document.createElement("div");
  wrap.className = "grid twocol";
  wrap.innerHTML = `
    <aside class="panel left">
      <h2>未配置（<span id="count">0</span>名）</h2>
      <div class="hint">左から右へドラッグ＆ドロップ</div>
      <div id="pool" class="cards"></div>
    </aside>
    <section class="panel right">
      <h2>フロア図</h2>
      <div id="floor"></div>
    </section>
  `;
  const toolbar = document.createElement("div");
  toolbar.className = "panel panel-toolbar";
  toolbar.innerHTML = `
    <label>表示日<input type="date" id="assignmentDate" /></label>
    <div id="viewMode" class="hint"></div>
  `;
  mount.appendChild(toolbar);
  mount.appendChild(wrap);

  const poolEl = wrap.querySelector("#pool");
  const floorEl = wrap.querySelector("#floor");
  const countEl = wrap.querySelector("#count");
  const dateInput = toolbar.querySelector("#assignmentDate");
  const viewModeEl = toolbar.querySelector("#viewMode");

  // 初期（インポート直後の暫定値）
  let workers = Array.isArray(state.workers)
    ? state.workers.map((w) =>
        typeof w === "string" ? { workerId: w, name: w } : w
      )
    : [];

  // プール/フロア共通で使う workerMap（色・時間も含む）
  let workerMap = new Map(
    workers.map((w) => [
      w.workerId,
      {
        name: w.name || w.workerId,
        defaultStartTime: w.defaultStartTime || "",
        defaultEndTime: w.defaultEndTime || "",
        panelColor: w.panel?.color || ""
      }
    ])
  );

  // エリア情報
  let areaList = DEFAULT_AREAS.slice();

  // フロア初期化
  const floorApi = makeFloor(floorEl, state.site, workerMap, areaList);
  makePool(poolEl, state.site);

  // 購読状態
  let latestAssignments = [];
  let unsubAssign = () => {};
  let unsubAreas = () => {};

  function reconcile() {
    floorApi.setReadOnly(isReadOnly);
    // フロア（在籍）更新
    floorApi.setWorkerMap(workerMap);
    floorApi.updateFromAssignments(latestAssignments);
    // プール（未配置= workers ー assigned）
    const assigned = new Set(latestAssignments.map((r) => r.workerId));
    const notAssigned = workers.filter((w) => !assigned.has(w.workerId));
    drawPool(poolEl, notAssigned, { readOnly: isReadOnly });
    countEl.textContent = String(notAssigned.length);
    updateViewMode();
  }

  // 作業者マスタ購読（色・時間・active・名前）
  const unsubWorkers = subscribeWorkers((rows) => {
    const active = rows.filter((w) => w.active);
    workers = active.map((w) => ({
      workerId: w.workerId,
      name: w.name || w.workerId,
      defaultStartTime: w.defaultStartTime || "",
      defaultEndTime: w.defaultEndTime || "",
      panel: { color: w.panel?.color || "" }
    }));
    workerMap = new Map(
      workers.map((w) => [
        w.workerId,
        {
          name: w.name,
          defaultStartTime: w.defaultStartTime,
          defaultEndTime: w.defaultEndTime,
          panelColor: w.panel?.color || ""
        }
      ])
    );
    reconcile();
  });

  function updateViewMode() {
    if (!viewModeEl) return;
    if (!isReadOnly) {
      viewModeEl.textContent = "本日の在籍はリアルタイムで編集できます。";
    } else {
      viewModeEl.textContent = "過去日の閲覧モード（編集不可）";
    }
  }

  function timestampToMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts === "number") return ts;
    if (typeof ts.seconds === "number") return ts.seconds * 1000;
    return 0;
  }

  function dedupeAssignments(rows) {
    const map = new Map();
    (rows || []).forEach((row) => {
      if (!row?.workerId) return;
      const stamp = timestampToMillis(row.updatedAt) || timestampToMillis(row.inAt);
      const current = map.get(row.workerId);
      if (!current || stamp >= current._ts) {
        map.set(row.workerId, { ...row, _ts: stamp });
      }
    });
    return Array.from(map.values()).map(({ _ts, ...rest }) => rest);
  }

  function startLiveSubscription() {
    stopLiveSubscription();
    latestAssignments = [];
    reconcile();
    unsubAssign = subscribeActiveAssignments(state.site, (rows) => {
      latestAssignments = dedupeAssignments(rows);
      reconcile();
    });
  }

  function stopLiveSubscription() {
    try {
      unsubAssign?.();
    } catch {}
    unsubAssign = () => {};
  }

  async function loadAssignmentsForDate(dateStr) {
    selectedDate = dateStr || todayStr;
    set({ assignmentDate: selectedDate });
    if (dateInput && dateInput.value !== selectedDate) {
      dateInput.value = selectedDate;
    }
    if (selectedDate === todayStr) {
      isReadOnly = false;
      updateViewMode();
      startLiveSubscription();
    } else {
      isReadOnly = true;
      updateViewMode();
      stopLiveSubscription();
      try {
        const rows = await getAssignmentsByDate({
          siteId: state.site.siteId,
          floorId: state.site.floorId,
          date: selectedDate
        });
        latestAssignments = dedupeAssignments(rows);
      } catch (err) {
        console.error("getAssignmentsByDate failed", err);
        toast("在籍データの取得に失敗しました", "error");
        latestAssignments = [];
      }
    }
    reconcile();
  }

  // 日付入力初期化
  if (dateInput) {
    dateInput.value = selectedDate;
    dateInput.addEventListener("change", (e) => {
      const val = e.target.value || todayStr;
      loadAssignmentsForDate(val);
    });
  }

  // エリア購読
  unsubAreas = subscribeAreas(state.site, (areas) => {
    areaList = areas;
    floorApi.setAreas(areaList);
    reconcile();
  });

  // 初期ロード
  if (selectedDate === todayStr) {
    startLiveSubscription();
  } else {
    loadAssignmentsForDate(selectedDate);
  }
  updateViewMode();

  // アンマウント
  window.addEventListener(
    "hashchange",
    () => {
      stopLiveSubscription();
      try {
        unsubWorkers();
      } catch {}
      try {
        unsubAreas();
      } catch {}
      try {
        floorApi.unmount?.();
      } catch {}
    },
    { once: true }
  );
}
