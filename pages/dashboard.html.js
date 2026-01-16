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
  DEFAULT_FLOORS,
  DEFAULT_SKILL_SETTINGS,
  upsertWorker,
  saveDailyRoster,
  updateAssignmentTimeNotes,
  subscribeSkillSettings
} from "../api/firebase.js";
import { toast } from "../core/ui.js";
import { normalizeSkillLevels } from "../modules/skill-layout.js";

const ALL_FLOOR_VALUE = "__all__";
const DEFAULT_FONT_SCALE = 1;
const FONT_SCALE_KEY = "dashboardFontScale";
const FONT_SCALE_MIN = 0.5;
const FONT_SCALE_MAX = 1.2;

export function renderDashboard(mount) {
  const todayStr = new Date().toISOString().slice(0, 10);
  let selectedDate = state.assignmentDate || todayStr;
  let isReadOnly = selectedDate !== todayStr;
  let skillSettings = DEFAULT_SKILL_SETTINGS;
  if (!state.site?.userId || !state.site?.siteId) {
    const panel = document.createElement("div");
    panel.className = "panel";
    panel.innerHTML = `<div class="hint">サイトが選択されていません。ログインし、サイトを選択してください。</div>`;
    mount.appendChild(panel);
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "grid twocol dashboard-grid";
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
    <button type="button" id="toggleFallback" class="toggle-pool" aria-pressed="true" title="未配置カラムを非表示">
      <span class="icon" aria-hidden="true">≡</span>
      <span class="label">未配置カラム</span>
    </button>
    <label>文字サイズ
      <select id="fontScale">
        <option value="0.5">極小</option>
        <option value="0.7">小</option>
        <option value="0.9">標準</option>
        <option value="1.1">大</option>
      </select>
    </label>
    <div id="viewMode" class="hint"></div>
  `;
  mount.appendChild(toolbar);
  mount.appendChild(wrap);

  const poolEl = wrap.querySelector("#pool");
  const floorEl = wrap.querySelector("#floor");
  const countEl = wrap.querySelector("#count");
  const dateInput = toolbar.querySelector("#assignmentDate");
  const floorSelect = toolbar.querySelector("#floorSelect");
  const fallbackToggle = toolbar.querySelector("#toggleFallback");
  const viewModeEl = toolbar.querySelector("#viewMode");
  const fontScaleSelect = toolbar.querySelector("#fontScale");

  function normalizeFontScale(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return DEFAULT_FONT_SCALE;
    const clamped = Math.min(Math.max(num, FONT_SCALE_MIN), FONT_SCALE_MAX);
    return Math.round(clamped * 100) / 100;
  }

  function readFontScale() {
    if (typeof localStorage === "undefined") return DEFAULT_FONT_SCALE;
    const stored = Number(localStorage.getItem(FONT_SCALE_KEY));
    return normalizeFontScale(Number.isFinite(stored) ? stored : DEFAULT_FONT_SCALE);
  }

  function applyFontScale(scale) {
    const normalized = normalizeFontScale(scale);
    wrap.style.setProperty("--dashboard-font-scale", normalized);
    if (fontScaleSelect) {
      fontScaleSelect.value = normalized.toString();
    }
    return normalized;
  }

  function persistFontScale(scale) {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(FONT_SCALE_KEY, String(scale));
  }

  applyFontScale(readFontScale());

  function toWorkerMaster(row) {
    if (!row) return null;
    if (typeof row === "string") {
      return {
        workerId: row,
        name: row,
        defaultStartTime: "",
        defaultEndTime: "",
        employmentCount: 0,
        memo: "",
        panel: { color: "" },
        skillLevels: {}
      };
    }
    const workerId = row.workerId || "";
    if (!workerId) return null;
    const skillLevels = normalizeSkillLevels(row.skillLevels || row.skill_levels);
    return {
      workerId,
      name: row.name || workerId,
      defaultStartTime: row.defaultStartTime || "",
      defaultEndTime: row.defaultEndTime || "",
      employmentCount: Number(row.employmentCount || 0),
      memo: row.memo || "",
      panel: { color: row.panel?.color || row.panelColor || "" },
      skillLevels
    };
  }

  function toRosterEntry(row, floorId = "") {
    if (!row) return null;
    if (typeof row === "string") {
      return {
        workerId: row,
        name: row,
        areaId: "",
        floorId,
        mentorId: "",
        groupOrder: 0
      };
    }
    const workerId = row.workerId || "";
    if (!workerId) return null;
    return {
      workerId,
      name: row.name || workerId,
      areaId: row.areaId || "",
      floorId: row.floorId || floorId || "",
      mentorId: row.mentorId || "",
      groupOrder: typeof row.groupOrder === "number" ? row.groupOrder : 0
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
        panelColor: w.panel?.color || "",
        employmentCount: Number(w.employmentCount || 0),
        memo: w.memo || "",
        skillLevels: normalizeSkillLevels(w.skillLevels)
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
  let showFallback = true;

  // エリア情報
  const defaultFloorId = state.site.floorId || DEFAULT_FLOORS[0]?.id || "";
  let areaList = DEFAULT_AREAS.map((a, idx) => ({
    ...a,
    floorId: defaultFloorId,
    floorLabel: defaultFloorId || DEFAULT_FLOORS[0]?.label || "",
    floorOrder: idx
  }));
  let areaLayoutMap = new Map([[defaultFloorId, { columns: 0 }]]);
  const areaCache = new Map();
  const areaSubscriptions = new Map();

  const workerEditor = createWorkerEditor();

  function updatePoolVisibility() {
    const isActive = Boolean(showFallback);
    fallbackToggle.setAttribute("aria-pressed", isActive);
    fallbackToggle.dataset.active = isActive ? "true" : "false";
    fallbackToggle.title = isActive
      ? "未配置カラムを非表示"
      : "未配置カラムを表示";
    wrap.classList.toggle("pool-hidden", !isActive);
    floorApi.setFallbackVisibility(isActive);
  }

  function getWorkerForEditing(workerId) {
    const master = masterWorkerLookup.get(workerId) || {};
    const mapEntry = workerMap.get(workerId) || {};
    const rosterEntry = rosterEntries.get(workerId) || {};
    return {
      workerId,
      name: master.name || mapEntry.name || rosterEntry.name || workerId,
      defaultStartTime:
        master.defaultStartTime || mapEntry.defaultStartTime || "",
      defaultEndTime: master.defaultEndTime || mapEntry.defaultEndTime || "",
      employmentCount:
        Number(master.employmentCount ?? mapEntry.employmentCount ?? 0) || 0,
      memo: master.memo || mapEntry.memo || "",
      panelColor: master.panel?.color || mapEntry.panelColor || "",
      skillLevels: normalizeSkillLevels(
        master.skillLevels || mapEntry.skillLevels || rosterEntry.skillLevels
      )
    };
  }

  function openWorkerEditor(workerId) {
    if (!workerId) return;
    workerEditor.open(getWorkerForEditing(workerId));
  }

  function buildMentorshipMap() {
    const map = new Map();
    rosterEntries.forEach((entry) => {
      if (!entry?.workerId) return;
      map.set(entry.workerId, {
        mentorId: entry.mentorId || "",
        groupOrder: typeof entry.groupOrder === "number" ? entry.groupOrder : 0,
        areaId: entry.areaId || "",
        floorId: entry.floorId || ""
      });
    });
    return map;
  }

  function resolveRosterEntry(workerId, areaId = "", floorId = "") {
    if (!workerId) return null;
    const existing = rosterEntries.get(workerId);
    if (existing) return existing;
    const master = workerMap.get(workerId) || masterWorkerLookup.get(workerId) || {};
    return {
      workerId,
      name: master.name || workerId,
      areaId: areaId || "",
      floorId,
      mentorId: "",
      groupOrder: 0
    };
  }

  async function handleMentorshipChange({
    workerId,
    mentorId = "",
    areaId = "",
    floorId = "",
    groupOrder = 0
  }) {
    if (!workerId) return false;
    if (isReadOnly) {
      toast("過去日は編集できません", "error");
      return false;
    }
    if (!state.site?.userId || !state.site?.siteId) {
      toast("サイト情報が不足しているため保存できません", "error");
      return false;
    }
    const resolvedFloorId = floorId || state.site.floorId || floorList?.[0]?.id || "";
    const resolvedAreaId = areaId || rosterEntries.get(workerId)?.areaId || "";
    const current = resolveRosterEntry(workerId, resolvedAreaId, resolvedFloorId);
    if (!current) return false;
    const nextEntry = {
      ...current,
      mentorId: mentorId || "",
      groupOrder: typeof groupOrder === "number" ? groupOrder : 0,
      areaId: resolvedAreaId,
      floorId: resolvedFloorId
    };
    rosterEntries.set(workerId, nextEntry);
    const rosterByFloor = Array.from(rosterEntries.values()).filter(
      (entry) => (entry.floorId || "") === resolvedFloorId
    );
    try {
      await saveDailyRoster({
        userId: state.site.userId,
        siteId: state.site.siteId,
        floorId: resolvedFloorId,
        date: selectedDate,
        workers: rosterByFloor
      });
      floorApi.setMentorshipMap(buildMentorshipMap());
      reconcile();
      return true;
    } catch (err) {
      console.error("[Dashboard] failed to save mentorship", err);
      toast("教育関係の保存に失敗しました", "error");
      return false;
    }
  }

  // フロア初期化
  const floorApi = makeFloor(
    floorEl,
    state.site,
    workerMap,
    { areas: areaList, layouts: areaLayoutMap },
    {
      onEditWorker: openWorkerEditor,
      skillSettings,
      onMentorshipChange: handleMentorshipChange
    }
  );
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
          panelColor: "",
          employmentCount: 0,
          memo: "",
          floorId: entry.floorId || "",
          skillLevels: normalizeSkillLevels(entry.skillLevels)
        });
      }
    });
    latestAssignmentsAll.forEach((row) => {
      if (!row?.workerId) return;
      if (!map.has(row.workerId)) {
        map.set(row.workerId, {
          name: row.workerId,
          defaultStartTime: "",
          defaultEndTime: "",
          panelColor: "",
          employmentCount: 0,
          memo: "",
          skillLevels: normalizeSkillLevels(row.skillLevels)
        });
      }
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
          employmentCount: Number(master.employmentCount || 0),
          memo: master.memo || "",
          panel: { color: master.panel?.color || "" },
          skillLevels: normalizeSkillLevels(master.skillLevels)
        };
      }
      return {
        workerId: entry.workerId,
        name: entry.name || entry.workerId,
        defaultStartTime: "",
        defaultEndTime: "",
        employmentCount: 0,
        memo: "",
        panel: { color: "" },
        skillLevels: {}
      };
    });
  }

  function reconcile() {
    floorApi.setReadOnly(isReadOnly);
    workerMap = buildWorkerMap();
    // フロア（在籍）更新
    floorApi.setWorkerMap(workerMap);
    floorApi.setMentorshipMap(buildMentorshipMap());
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
          _source: "roster",
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
    drawPool(poolEl, notAssigned, {
      readOnly: isReadOnly,
      onEditWorker: openWorkerEditor,
      skillSettings
    });
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
            panelColor: w.panel?.color || "",
            employmentCount: Number(w.employmentCount || 0),
            memo: w.memo || "",
            skillLevels: normalizeSkillLevels(w.skillLevels)
          }
        ])
      );
      reconcile();
    }
  );

  const unsubSkillSettings = subscribeSkillSettings(
    {
      userId: state.site.userId,
      siteId: state.site.siteId
    },
    (settings) => {
      skillSettings = settings || { ...DEFAULT_SKILL_SETTINGS };
      floorApi.setSkillSettings(skillSettings);
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

  function toPositiveInt(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : null;
  }

  function normalizeLayoutConfig(layout = {}) {
    const columns = toPositiveInt(layout.columns);
    return { columns: columns && columns > 0 && columns <= 12 ? columns : 0 };
  }

  function normalizeAreaPayload(payload) {
    if (Array.isArray(payload)) {
      return { areas: payload, layout: { columns: 0 } };
    }
    return {
      areas: Array.isArray(payload?.areas) ? payload.areas : [],
      layout: normalizeLayoutConfig(payload?.layout || {})
    };
  }

  function decorateAreasForFloor(floorId, payload = DEFAULT_AREAS) {
    const metaMap = getFloorLabelMap();
    const meta = metaMap.get(floorId) || { label: floorId || "", order: 0 };
    const { areas: targetAreas, layout } = normalizeAreaPayload(payload);
    const list = Array.isArray(targetAreas) ? targetAreas : [];
    const decoratedAreas = list.map((a, idx) => ({
      ...a,
      gridColumn: toPositiveInt(a.gridColumn || a.column),
      gridRow: toPositiveInt(a.gridRow || a.row),
      colSpan: toPositiveInt(a.colSpan || a.gridColSpan),
      rowSpan: toPositiveInt(a.rowSpan || a.gridRowSpan),
      floorId,
      floorLabel: meta.label,
      floorOrder: typeof meta.order === "number" ? meta.order : idx
    }));
    return { areas: decoratedAreas, layout: normalizeLayoutConfig(layout) };
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
      (payload) => {
        areaCache.set(floorId, normalizeAreaPayload(payload));
        refreshAreasForView();
      }
    );
    areaSubscriptions.set(floorId, unsub);
  }

  function refreshAreasForView() {
    const targets = getTargetFloorsForView();
    if (!targets.length) {
      const decorated = decorateAreasForFloor("", DEFAULT_AREAS);
      areaList = decorated.areas;
      areaLayoutMap = new Map([["", decorated.layout]]);
      floorApi.setAreas({ areas: areaList, layouts: areaLayoutMap });
      reconcile();
      return;
    }
    const layoutMap = new Map();
    const merged = targets.flatMap((floorId) => {
      const cached = areaCache.has(floorId) ? areaCache.get(floorId) : [];
      const { areas, layout } = decorateAreasForFloor(floorId, cached);
      layoutMap.set(floorId, layout);
      return areas;
    });
    areaList = merged;
    areaLayoutMap = layoutMap;
    floorApi.setAreas({ areas: areaList, layouts: areaLayoutMap });
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
        // フロア構成が更新されたら現在のビューに必要なエリア購読を更新する
        subscribeAreasForCurrentFloor();
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

  if (fontScaleSelect) {
    fontScaleSelect.addEventListener("change", (e) => {
      const applied = applyFontScale(e.target.value);
      persistFontScale(applied);
    });
  }

  if (floorSelect) {
    floorSelect.addEventListener("change", (e) => {
      const next = e.target.value || "";
      handleFloorChange(next);
    });
  }

  if (fallbackToggle) {
    updatePoolVisibility();
    fallbackToggle.addEventListener("click", () => {
      showFallback = !showFallback;
      updatePoolVisibility();
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

  function createWorkerEditor() {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal">
        <h3>作業員情報を編集</h3>
        <form class="form" id="workerEditForm">
          <label>作業員ID<input name="workerId" disabled></label>
          <label>氏名<input name="name" placeholder="氏名"></label>
          <label>開始時刻<input type="time" name="defaultStartTime"></label>
          <label>終了時刻<input type="time" name="defaultEndTime"></label>
          <label>就業回数<input type="number" name="employmentCount" min="0"></label>
          <label>時間メモ（左）<input name="timeNoteLeft" maxlength="6" placeholder="例: 休"></label>
          <label>時間メモ（右）<input name="timeNoteRight" maxlength="6" placeholder="例: 遅"></label>
          <label>備考<textarea name="memo" placeholder="メモや特記事項"></textarea></label>
          <div class="actions">
            <button type="button" class="button ghost" data-cancel>閉じる</button>
            <button type="submit" class="button" data-save>保存</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(overlay);
    const form = overlay.querySelector("form");
    const cancelBtn = overlay.querySelector("[data-cancel]");
    const saveBtn = overlay.querySelector("[data-save]");
    const workerIdInput = overlay.querySelector('input[name="workerId"]');
    const nameInput = overlay.querySelector('input[name="name"]');
    const startInput = overlay.querySelector('input[name="defaultStartTime"]');
    const endInput = overlay.querySelector('input[name="defaultEndTime"]');
    const countInput = overlay.querySelector('input[name="employmentCount"]');
    const timeNoteLeftInput = overlay.querySelector('input[name="timeNoteLeft"]');
    const timeNoteRightInput = overlay.querySelector('input[name="timeNoteRight"]');
    const memoInput = overlay.querySelector('textarea[name="memo"]');
    let currentWorkerId = "";
    let currentAssignmentId = "";
    let currentSkillLevels = {};

    function close() {
      overlay.classList.remove("show");
    }

    function setTimeNoteInputsEnabled(enabled) {
      if (timeNoteLeftInput) timeNoteLeftInput.disabled = !enabled;
      if (timeNoteRightInput) timeNoteRightInput.disabled = !enabled;
    }

    function getActiveAssignment(workerId) {
      return latestAssignmentsAll.find(
        (row) => row.workerId === workerId && row._source !== "roster"
      );
    }

    function open(worker) {
      if (!worker) return;
      currentWorkerId = worker.workerId || "";
      const assignment = getActiveAssignment(currentWorkerId);
      currentAssignmentId = assignment?.id || "";
      workerIdInput.value = currentWorkerId;
      nameInput.value = worker.name || currentWorkerId;
      startInput.value = worker.defaultStartTime || "";
      endInput.value = worker.defaultEndTime || "";
      countInput.value = Number(worker.employmentCount || 0);
      if (timeNoteLeftInput) {
        timeNoteLeftInput.value =
          typeof assignment?.timeNoteLeft === "string" ? assignment.timeNoteLeft : "";
      }
      if (timeNoteRightInput) {
        timeNoteRightInput.value =
          typeof assignment?.timeNoteRight === "string"
            ? assignment.timeNoteRight
            : "";
      }
      setTimeNoteInputsEnabled(Boolean(currentAssignmentId) && !isReadOnly);
      memoInput.value = worker.memo || "";
      currentSkillLevels = normalizeSkillLevels(worker.skillLevels);
      overlay.classList.add("show");
      nameInput.focus();
    }

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    cancelBtn?.addEventListener("click", (e) => {
      e.preventDefault();
      close();
    });

    form?.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!currentWorkerId) return;
      if (!state.site?.userId || !state.site?.siteId) {
        toast("サイト情報が不足しているため保存できません", "error");
        return;
      }
      const payload = {
        workerId: currentWorkerId,
        name: nameInput.value.trim() || currentWorkerId,
        defaultStartTime: startInput.value || "",
        defaultEndTime: endInput.value || "",
        employmentCount: Number(countInput.value || 0),
        memo: memoInput.value || "",
        active: true,
        skillLevels: currentSkillLevels
      };
      const timeNoteLeft = timeNoteLeftInput?.value?.trim() || "";
      const timeNoteRight = timeNoteRightInput?.value?.trim() || "";
      try {
        if (saveBtn) saveBtn.disabled = true;
        if (saveBtn) saveBtn.textContent = "保存中...";
        await upsertWorker({
          userId: state.site.userId,
          siteId: state.site.siteId,
          ...payload
        });
        if (currentAssignmentId && !isReadOnly) {
          await updateAssignmentTimeNotes({
            userId: state.site.userId,
            siteId: state.site.siteId,
            assignmentId: currentAssignmentId,
            timeNoteLeft,
            timeNoteRight
          });
          latestAssignmentsAll = latestAssignmentsAll.map((row) =>
            row.id === currentAssignmentId
              ? { ...row, timeNoteLeft, timeNoteRight }
              : row
          );
        }
        reconcile();
        toast(`保存しました：${currentWorkerId}`);
        close();
      } catch (err) {
        console.error("[Dashboard] failed to save worker", err);
        toast("作業員の保存に失敗しました", "error");
      } finally {
        if (saveBtn) saveBtn.disabled = false;
        if (saveBtn) saveBtn.textContent = "保存";
      }
    });

    return { open, close };
  }

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
        unsubSkillSettings();
      } catch (err) {
        console.warn("unsubSkillSettings failed", err);
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
      try {
        workerEditor?.close?.();
      } catch (err) {
        console.error("workerEditor.close failed", err);
      }
    },
    { once: true }
  );
}
