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

const ALL_FLOOR_VALUE = "__all__";

export function renderDashboard(mount) {
  const todayStr = new Date().toISOString().slice(0, 10);
  let selectedDate = state.assignmentDate || todayStr;
  let isReadOnly = selectedDate !== todayStr;
  if (!state.site?.userId || !state.site?.siteId) {
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `<div class="hint">サイトが選択されていません。ログインし、サイトを選択してください。</div>`;
    mount.appendChild(panel);
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "grid twocol";
  wrap.innerHTML = `
    <aside class="panel left dashboard-pool-panel">
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

  function toRosterEntry(row, floorId = "") {
    if (!row) return null;
    if (typeof row === "string") {
      return { workerId: row, name: row, areaId: "", floorId };
    }
    const workerId = row.workerId || "";
    if (!workerId) return null;
    return {
      workerId,
      name: row.name || workerId,
      areaId: row.areaId || "",
      floorId: row.floorId || floorId || ""
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
            .map((row) => toRosterEntry(row))
            .filter((w) => w && w.workerId)
            .map((w) => [w.workerId, w])
        )
      : new Map();
  let workerMap = new Map(masterWorkerMap);
  let floorList = DEFAULT_FLOORS.slice();

  // エリア情報
  let areaList = DEFAULT_AREAS.map((a, idx) => ({
    ...a,
    floorId: state.site.floorId || DEFAULT_FLOORS[0]?.id || "",
    floorLabel: state.site.floorId || DEFAULT_FLOORS[0]?.label || "",
    floorOrder: idx
  }));
  const areaCache = new Map();
  const areaSubscriptions = new Map();

  // フロア初期化
  const floorApi = makeFloor(floorEl, state.site, workerMap, areaList);
  makePool(poolEl, state.site);

  // 購読状態
  let latestAssignmentsAll = [];
  let unsubAssign = () => {};
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
    latestAssignmentsAll.forEach((row) => {
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
    const isAllFloorsView = state.site.floorId === ALL_FLOOR_VALUE;
    const currentFloorId = isAllFloorsView ? "" : state.site.floorId;
    const assignmentsForView = isAllFloorsView
      ? latestAssignmentsAll.slice()
      : currentFloorId
      ? latestAssignmentsAll.filter((a) => a.floorId === currentFloorId)
      : latestAssignmentsAll.slice();
    const displayAssignments = assignmentsForView.slice();
    const assignedForFloor = new Set(assignmentsForView.map((r) => r.workerId));
    const assignedAll = new Set(latestAssignmentsAll.map((r) => r.workerId));

    if (isReadOnly && rosterEntries.size) {
      const pseudoAssignments = [];
      rosterEntries.forEach((entry) => {
        if (!entry?.workerId || !entry.areaId) return;
        const targetFloorId = entry.floorId || currentFloorId || "";
        if (
          !isAllFloorsView &&
          currentFloorId &&
          targetFloorId &&
          targetFloorId !== currentFloorId
        ) {
          return;
        }
        if (assignedForFloor.has(entry.workerId)) return;
        assignedForFloor.add(entry.workerId);
        assignedAll.add(entry.workerId);
        pseudoAssignments.push({
          id: `roster-${entry.workerId}`,
          workerId: entry.workerId,
          areaId: entry.areaId,
          floorId: targetFloorId,
          _source: "roster"
        });
      });
      if (pseudoAssignments.length) {
        displayAssignments.push(...pseudoAssignments);
      }
    }

    floorApi.updateFromAssignments(displayAssignments);
    // プール（未配置= roster ー assigned）
    const rosterWorkers = rosterWorkersForPool();
    const notAssigned = rosterWorkers.filter((w) => !assignedAll.has(w.workerId));
    drawPool(poolEl, notAssigned, { readOnly: isReadOnly });
    countEl.textContent = String(notAssigned.length);
    updateViewMode();
  }

  // 作業者マスタ購読（色・時間・active・名前）
  const unsubWorkers = subscribeWorkers(
    {
      userId: state.site.userId,
      siteId: state.site.siteId
    },
    (rows) => {
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
    }
  );

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

  function startLiveSubscription(dateStr = selectedDate) {
    stopLiveSubscription();
    latestAssignmentsAll = [];
    reconcile();
    unsubAssign = subscribeActiveAssignments(
      {
        userId: state.site.userId,
        siteId: state.site.siteId,
        date: dateStr
      },
      (rows) => {
        latestAssignmentsAll = dedupeAssignments(rows);
        reconcile();
      }
    );
  }

  function stopLiveSubscription() {
    try {
      unsubAssign?.();
    } catch (err) {
      console.warn("unsubAssign failed", err);
    }
    unsubAssign = () => {};
  }

  async function loadAssignmentsSnapshotForDate(dateStr) {
    try {
      const rows = await getAssignmentsByDate({
        userId: state.site.userId,
        siteId: state.site.siteId,
        date: dateStr
      });
      latestAssignmentsAll = dedupeAssignments(rows);
    } catch (err) {
      console.error("getAssignmentsByDate failed", err);
      toast("在籍データの取得に失敗しました", "error");
      latestAssignmentsAll = [];
    }
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
      startLiveSubscription(selectedDate);
    } else {
      isReadOnly = true;
      updateViewMode();
      stopLiveSubscription();
      await loadAssignmentsSnapshotForDate(selectedDate);
    }
    reconcile();
  }

  async function loadRosterForDate(dateStr) {
    const floors =
      floorList && floorList.length ? floorList.map((f) => f.id).filter(Boolean) : [];
    const targets = floors.length
      ? floors
      : (state.site.floorId ? [state.site.floorId] : []);
    if (!targets.length) {
      rosterEntries = new Map();
      reconcile();
      return;
    }
    const combined = new Map();
    await Promise.all(
      targets.map(async (floorId) => {
        try {
          const { workers } = await getDailyRoster({
            userId: state.site.userId,
            siteId: state.site.siteId,
            floorId,
            date: dateStr
          });
          (workers || [])
            .map((row) => toRosterEntry(row, floorId))
            .filter((w) => w && w.workerId)
            .forEach((entry) => {
              if (!combined.has(entry.workerId)) {
                combined.set(entry.workerId, entry);
              }
            });
        } catch (err) {
          console.error("getDailyRoster failed", err);
          toast("作業者リストの取得に失敗しました", "error");
        }
      })
    );
    rosterEntries = combined;
    reconcile();
  }

  function getEffectiveFloors() {
    const list = floorList && floorList.length ? floorList : DEFAULT_FLOORS;
    return list.map((f, idx) => ({
      ...f,
      order: typeof f.order === "number" ? f.order : idx
    }));
  }

  function getFloorLabelMap() {
    const map = new Map();
    getEffectiveFloors().forEach((f, idx) => {
      const order = typeof f.order === "number" ? f.order : idx;
      map.set(f.id, { label: f.label || f.id, order });
    });
    return map;
  }

  function decorateAreasForFloor(floorId, areas = DEFAULT_AREAS) {
    const metaMap = getFloorLabelMap();
    const meta = metaMap.get(floorId) || { label: floorId || "", order: 0 };
    const list = Array.isArray(areas) ? areas : DEFAULT_AREAS;
    return list.map((a, idx) => ({
      ...a,
      floorId,
      floorLabel: meta.label,
      floorOrder: typeof meta.order === "number" ? meta.order : idx
    }));
  }

  function getTargetFloorsForView() {
    const floors = getEffectiveFloors();
    if (state.site.floorId === ALL_FLOOR_VALUE) {
      return floors.map((f) => f.id).filter(Boolean);
    }
    const current = state.site.floorId || floors[0]?.id || "";
    return current ? [current] : [];
  }

  function cleanupAreaSubscriptions(activeFloors = new Set()) {
    const removeKeys = [];
    areaSubscriptions.forEach((unsub, floorId) => {
      if (activeFloors.has(floorId)) return;
      try {
        unsub?.();
      } catch (err) {
        console.warn("unsubAreas failed", err);
      }
      removeKeys.push(floorId);
      areaCache.delete(floorId);
    });
    removeKeys.forEach((id) => areaSubscriptions.delete(id));
  }

  function unsubscribeAllAreas() {
    cleanupAreaSubscriptions(new Set());
  }

  function ensureAreaSubscription(floorId) {
    if (!floorId || areaSubscriptions.has(floorId)) return;
    const unsub = subscribeAreas(
      {
        userId: state.site.userId,
        siteId: state.site.siteId,
        floorId
      },
      (areas) => {
        areaCache.set(floorId, areas);
        refreshAreasForView();
      }
    );
    areaSubscriptions.set(floorId, unsub);
  }

  function refreshAreasForView() {
    const targets = getTargetFloorsForView();
    if (!targets.length) {
      areaList = decorateAreasForFloor("", DEFAULT_AREAS);
      floorApi.setAreas(areaList);
      reconcile();
      return;
    }
    const merged = targets.flatMap((floorId) => {
      const cached = areaCache.get(floorId);
      return decorateAreasForFloor(floorId, cached);
    });
    areaList = merged;
    floorApi.setAreas(areaList);
    reconcile();
  }

  function subscribeAreasForCurrentFloor() {
    const targets = getTargetFloorsForView();
    const activeSet = new Set(targets);
    cleanupAreaSubscriptions(activeSet);
    if (!targets.length) {
      refreshAreasForView();
      return;
    }
    targets.forEach((floorId) => ensureAreaSubscription(floorId));
    refreshAreasForView();
  }

  function renderFloorOptions() {
    if (!floorSelect) return;
    const baseList = floorList && floorList.length ? floorList : DEFAULT_FLOORS;
    const options = [{ id: ALL_FLOOR_VALUE, label: "全体" }, ...baseList];
    floorSelect.innerHTML = options
      .map((f) => `<option value="${f.id}">${f.label || f.id}</option>`)
      .join("");
    const fallback = baseList[0]?.id || ALL_FLOOR_VALUE;
    const current = state.site.floorId || fallback;
    if (current) {
      floorSelect.value = current;
    }
    floorSelect.disabled = options.length <= 1;
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
    } catch (err) {
      console.warn("unsubFloors failed", err);
    }
    unsubFloors = subscribeFloors(
      {
        userId: state.site.userId,
        siteId: state.site.siteId
      },
      (floors) => {
        floorList =
          Array.isArray(floors) && floors.length
            ? floors
            : DEFAULT_FLOORS.slice();
        renderFloorOptions();
        refreshAreasForView();
        loadRosterForDate(selectedDate).catch((err) => {
          console.error("loadRosterForDate failed", err);
        });
        const hasCurrent =
          state.site.floorId === ALL_FLOOR_VALUE ||
          floorList.some((f) => f.id === state.site.floorId);
        if (!hasCurrent && floorList[0]) {
          handleFloorChange(floorList[0].id, { force: true }).catch((err) => {
            console.error("handleFloorChange failed", err);
          });
        }
      }
    );
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
      } catch (err) {
        console.warn("unsubWorkers failed", err);
      }
      try {
        unsubscribeAllAreas();
      } catch (err) {
        console.warn("unsubAreas failed", err);
      }
      try {
        unsubFloors();
      } catch (err) {
        console.warn("unsubFloors failed", err);
      }
      try {
        floorApi.unmount?.();
      } catch (err) {
        console.error("floorApi.unmount failed", err);
      }
    },
    { once: true }
  );
}
