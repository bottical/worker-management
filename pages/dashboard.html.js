// pages/dashboard.html.js
import { state, set } from "../core/store.js";
import { makePool, drawPool } from "../modules/panel-pool.js";
import { makeFloor } from "../modules/panel-floor.js";
import {
  subscribeActiveAssignments,
  subscribeWorkers,
  getAssignmentsByDate,
  subscribeAreas,
  subscribeFloors,
  getDailyRoster,
  DEFAULT_AREAS,
  DEFAULT_FLOORS
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
    <label>フロア<select id="floorSelect"></select></label>
    <label>表示日<input type="date" id="assignmentDate" /></label>
    <div id="viewMode" class="hint"></div>
  `;
  mount.appendChild(toolbar);
  mount.appendChild(wrap);

  const poolEl = wrap.querySelector("#pool");
  const floorEl = wrap.querySelector("#floor");
  const countEl = wrap.querySelector("#count");
  const dateInput = toolbar.querySelector("#assignmentDate");
  const floorSelect = toolbar.querySelector("#floorSelect");
  const viewModeEl = toolbar.querySelector("#viewMode");

  function toWorkerMaster(row) {
    if (!row) return null;
    if (typeof row === "string") {
      return {
        workerId: row,
        name: row,
        defaultStartTime: "",
        defaultEndTime: "",
        panel: { color: "" }
      };
    }
    const workerId = row.workerId || "";
    if (!workerId) return null;
    return {
      workerId,
      name: row.name || workerId,
      defaultStartTime: row.defaultStartTime || "",
      defaultEndTime: row.defaultEndTime || "",
      panel: { color: row.panel?.color || row.panelColor || "" }
    };
  }

  function toRosterEntry(row) {
    if (!row) return null;
    if (typeof row === "string") {
      return { workerId: row, name: row, areaId: "" };
    }
    const workerId = row.workerId || "";
    if (!workerId) return null;
    return {
      workerId,
      name: row.name || workerId,
      areaId: row.areaId || ""
    };
  }

  let masterWorkers = Array.isArray(state.workers)
    ? state.workers.map(toWorkerMaster).filter((w) => w && w.workerId)
    : [];
  let masterWorkerLookup = new Map(
    masterWorkers.map((w) => [w.workerId, { ...w }])
  );
  let masterWorkerMap = new Map(
    masterWorkers.map((w) => [
      w.workerId,
      {
        name: w.name || w.workerId,
        defaultStartTime: w.defaultStartTime || "",
        defaultEndTime: w.defaultEndTime || "",
        panelColor: w.panel?.color || ""
      }
    ])
  );
  let rosterEntries =
    state.dateTab === selectedDate && Array.isArray(state.workers)
      ? new Map(
          state.workers
            .map(toRosterEntry)
            .filter((w) => w && w.workerId)
            .map((w) => [w.workerId, w])
        )
      : new Map();
  let workerMap = new Map(masterWorkerMap);
  let floorList = DEFAULT_FLOORS.slice();

  // エリア情報
  let areaList = DEFAULT_AREAS.slice();

  // フロア初期化
  const floorApi = makeFloor(floorEl, state.site, workerMap, areaList);
  makePool(poolEl, state.site);

  // 購読状態
  let latestAssignments = [];
  let unsubAssign = () => {};
  let unsubAreas = () => {};
  let unsubFloors = () => {};

  function buildWorkerMap() {
    const map = new Map(masterWorkerMap);
    rosterEntries.forEach((entry) => {
      if (!map.has(entry.workerId)) {
        map.set(entry.workerId, {
          name: entry.name || entry.workerId,
          defaultStartTime: "",
          defaultEndTime: "",
          panelColor: ""
        });
      }
    });
    latestAssignments.forEach((row) => {
      if (!row?.workerId || map.has(row.workerId)) return;
      map.set(row.workerId, {
        name: row.workerId,
        defaultStartTime: "",
        defaultEndTime: "",
        panelColor: ""
      });
    });
    return map;
  }

  function rosterWorkersForPool() {
    if (!rosterEntries.size) return [];
    return Array.from(rosterEntries.values()).map((entry) => {
      const master = masterWorkerLookup.get(entry.workerId);
      if (master) {
        return {
          workerId: master.workerId,
          name: master.name,
          defaultStartTime: master.defaultStartTime,
          defaultEndTime: master.defaultEndTime,
          panel: { color: master.panel?.color || "" }
        };
      }
      return {
        workerId: entry.workerId,
        name: entry.name || entry.workerId,
        defaultStartTime: "",
        defaultEndTime: "",
        panel: { color: "" }
      };
    });
  }

  function reconcile() {
    floorApi.setReadOnly(isReadOnly);
    workerMap = buildWorkerMap();
    // フロア（在籍）更新
    floorApi.setWorkerMap(workerMap);
    floorApi.updateFromAssignments(latestAssignments);
    // プール（未配置= roster ー assigned）
    const rosterWorkers = rosterWorkersForPool();
    const assigned = new Set(latestAssignments.map((r) => r.workerId));
    const notAssigned = rosterWorkers.filter((w) => !assigned.has(w.workerId));
    drawPool(poolEl, notAssigned, { readOnly: isReadOnly });
    countEl.textContent = String(notAssigned.length);
    updateViewMode();
  }

  // 作業者マスタ購読（色・時間・active・名前）
  const unsubWorkers = subscribeWorkers((rows) => {
    const active = rows.filter((w) => w.active);
    masterWorkers = active
      .map(toWorkerMaster)
      .filter((w) => w && w.workerId);
    masterWorkerLookup = new Map(
      masterWorkers.map((w) => [w.workerId, { ...w }])
    );
    masterWorkerMap = new Map(
      masterWorkers.map((w) => [
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
    await loadRosterForDate(selectedDate);
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

  async function loadRosterForDate(dateStr) {
    try {
      const { workers } = await getDailyRoster({
        siteId: state.site.siteId,
        floorId: state.site.floorId,
        date: dateStr
      });
      rosterEntries = new Map(
        (workers || [])
          .map(toRosterEntry)
          .filter((w) => w && w.workerId)
          .map((w) => [w.workerId, w])
      );
    } catch (err) {
      console.error("getDailyRoster failed", err);
      toast("作業者リストの取得に失敗しました", "error");
      rosterEntries = new Map();
    }
    reconcile();
  }

  function subscribeAreasForCurrentFloor() {
    try {
      unsubAreas();
    } catch {}
    unsubAreas = subscribeAreas(state.site, (areas) => {
      areaList = areas;
      floorApi.setAreas(areaList);
      reconcile();
    });
  }

  function renderFloorOptions() {
    if (!floorSelect) return;
    const list = floorList && floorList.length ? floorList : DEFAULT_FLOORS;
    floorSelect.innerHTML = list
      .map(
        (f) =>
          `<option value="${f.id}">${f.label || f.id}</option>`
      )
      .join("");
    const current = state.site.floorId || list[0]?.id || "";
    if (current) {
      floorSelect.value = current;
    }
    floorSelect.disabled = list.length <= 1;
  }

  async function handleFloorChange(newFloorId, { force = false } = {}) {
    if (!newFloorId) return;
    const current = state.site.floorId;
    if (!force && newFloorId === current) return;
    stopLiveSubscription();
    const nextSite = { ...state.site, floorId: newFloorId };
    set({ site: nextSite });
    floorApi.setSite(nextSite);
    subscribeAreasForCurrentFloor();
    if (floorSelect && floorSelect.value !== newFloorId) {
      floorSelect.value = newFloorId;
    }
    await loadAssignmentsForDate(selectedDate);
    renderFloorOptions();
  }

  function subscribeFloorsForSite() {
    try {
      unsubFloors();
    } catch {}
    unsubFloors = subscribeFloors(state.site, (floors) => {
      floorList =
        Array.isArray(floors) && floors.length
          ? floors
          : DEFAULT_FLOORS.slice();
      renderFloorOptions();
      const hasCurrent = floorList.some((f) => f.id === state.site.floorId);
      if (!hasCurrent && floorList[0]) {
        handleFloorChange(floorList[0].id, { force: true }).catch((err) => {
          console.error("handleFloorChange failed", err);
        });
      }
    });
  }

  // 日付入力初期化
  if (dateInput) {
    dateInput.value = selectedDate;
    dateInput.addEventListener("change", (e) => {
      const val = e.target.value || todayStr;
      loadAssignmentsForDate(val);
    });
  }

  if (floorSelect) {
    floorSelect.addEventListener("change", (e) => {
      const next = e.target.value || "";
      handleFloorChange(next);
    });
  }

  // エリア購読
  subscribeAreasForCurrentFloor();

  // フロア購読
  subscribeFloorsForSite();
  renderFloorOptions();

  // 初期ロード
  loadAssignmentsForDate(selectedDate);
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
        unsubFloors();
      } catch {}
      try {
        floorApi.unmount?.();
      } catch {}
    },
    { once: true }
  );
}
