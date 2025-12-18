// modules/panel-floor.js
import {
  createAssignment,
  closeAssignment,
  updateAssignmentsOrder,
  DEFAULT_AREAS,
  DEFAULT_SKILL_SETTINGS
} from "../api/firebase.js";
import { fmtRange, toast } from "../core/ui.js";
import { getContrastTextColor } from "../core/colors.js";
import { createSkillColumns, normalizeSkillLevels } from "./skill-layout.js";

/**
 * フロア（ゾーン）側の描画と、在籍の反映を担う
 * - workerMap を後から差し替え可能（色・時間の反映に対応）
 * - assignments購読から updateFromAssignments(rows) が呼ばれる前提
 */
const FALLBACK_AREA_ID = "__unassigned__";
const FALLBACK_AREA_LABEL = "未割当";

export function makeFloor(
  mount,
  site,
  workerMap = new Map(),
  areas = DEFAULT_AREAS,
  options = {}
) {
  let _workerMap = new Map(workerMap || []);
  const normalizedAreaPayload = normalizeAreaPayload(areas);
  let _areas = normalizeAreas(normalizedAreaPayload.areas);
  let _layout = normalizedAreaPayload.layout;
  let _layoutMap = normalizedAreaPayload.layouts;
  let _readOnly = false;
  let currentAssignments = [];
  let currentSite = { ...site };
  let _skillSettings = options.skillSettings || DEFAULT_SKILL_SETTINGS;
  let _showFallback = true;
  let fallbackZoneEls = new Map();
  const dragStates = new Map();
  const { onEditWorker, getLeaderFlag } = options;

  function toPositiveInt(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : null;
  }

  function timestampToMillis(ts) {
    if (!ts) return 0;
    if (typeof ts.toMillis === "function") return ts.toMillis();
    if (typeof ts === "number") return ts;
    if (typeof ts.seconds === "number") return ts.seconds * 1000;
    return 0;
  }

  function normalizeAreaId(areaId) {
    return areaId || FALLBACK_AREA_ID;
  }

  function areaKey(areaId, floorId) {
    return `${floorId || ""}__${normalizeAreaId(areaId)}`;
  }

  function sortAssignments(list = []) {
    return list.slice().sort((a, b) => {
      const orderDiff = (a.order ?? 0) - (b.order ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return timestampToMillis(a.updatedAt) - timestampToMillis(b.updatedAt);
    });
  }

  function groupAssignments(assignments = currentAssignments) {
    const map = new Map();
    (assignments || []).forEach((row) => {
      const key = areaKey(row.areaId, row.floorId);
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key).push(row);
    });
    return map;
  }

  function getAreaAssignments(areaId, floorId) {
    const key = areaKey(areaId, floorId);
    const grouped = groupAssignments();
    return sortAssignments(grouped.get(key) || []);
  }

  function listSlots(dropEl) {
    return Array.from(dropEl?.querySelectorAll(".slot") || []).filter(
      (slot) => !slot.classList.contains("placeholder-slot")
    );
  }

  function findInsertIndex(dropEl, clientY) {
    const slots = listSlots(dropEl);
    if (!slots.length) return 0;
    for (let i = 0; i < slots.length; i += 1) {
      const rect = slots[i].getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return i;
      }
    }
    return slots.length;
  }

  const placeholderSlots = new WeakMap();
  let activePlaceholderDrop = null;

  function ensurePlaceholder(dropEl) {
    if (!placeholderSlots.has(dropEl)) {
      const placeholder = document.createElement("div");
      placeholder.className = "slot placeholder-slot";
      placeholderSlots.set(dropEl, placeholder);
    }
    return placeholderSlots.get(dropEl);
  }

  function removePlaceholder(dropEl) {
    const placeholder = placeholderSlots.get(dropEl);
    if (placeholder?.parentElement === dropEl) {
      dropEl.removeChild(placeholder);
    }
    if (activePlaceholderDrop === dropEl) {
      activePlaceholderDrop = null;
    }
  }

  function clearActivePlaceholder() {
    if (activePlaceholderDrop) {
      removePlaceholder(activePlaceholderDrop);
    }
  }

  function showPlaceholder(dropEl, index) {
    const placeholder = ensurePlaceholder(dropEl);
    if (activePlaceholderDrop && activePlaceholderDrop !== dropEl) {
      removePlaceholder(activePlaceholderDrop);
    }
    const slots = listSlots(dropEl);
    const bounded = Math.max(0, Math.min(index, slots.length));
    const anchor = slots[bounded] || null;
    if (placeholder.parentElement !== dropEl) {
      dropEl.insertBefore(placeholder, anchor);
    } else if (placeholder !== anchor?.previousSibling) {
      dropEl.insertBefore(placeholder, anchor);
    }
    activePlaceholderDrop = dropEl;
  }

  async function persistOrders(updates, onErrorMessage = "並び順の更新に失敗しました") {
    if (!Array.isArray(updates) || updates.length === 0) return;
    if (!currentSite?.userId || !currentSite?.siteId) {
      notifyMissingContext();
      return;
    }
    try {
      await updateAssignmentsOrder({
        userId: currentSite.userId,
        siteId: currentSite.siteId,
        updates
      });
    } catch (err) {
      handleActionError(onErrorMessage, err);
    }
  }

  mount.innerHTML = "";
  const zonesEl = document.createElement("div");
  zonesEl.className = "zones";
  mount.appendChild(zonesEl);

  renderZones();

  function getWorkerInfo(workerId) {
    const w = _workerMap.get(workerId) || {};
    return {
      name: w.name || workerId,
      start: w.defaultStartTime || "",
      end: w.defaultEndTime || "",
      panelColor: w.panel?.color || w.panelColor || "",
      employmentCount: typeof w.employmentCount === "number"
        ? w.employmentCount
        : Number(w.employmentCount || 0),
      memo: w.memo || "",
      isLeader: Boolean(w.isLeader),
      skillLevels: normalizeSkillLevels(w.skillLevels)
    };
  }

  function applyAccent(cardEl, color) {
    if (!cardEl) return;
    if (color) {
      cardEl.style.setProperty("--card-accent", color);
      cardEl.style.setProperty("--card-accent-text", getContrastTextColor(color));
    } else {
      cardEl.style.removeProperty("--card-accent");
      cardEl.style.removeProperty("--card-accent-text");
    }
  }

  function getFloorLabel(floorId) {
    if (!floorId) return "";
    const area = _areas.find((a) => a.floorId === floorId && a.floorLabel);
    return area?.floorLabel || floorId;
  }

  function buildCardBody(info, areaId, floorId) {
    const body = document.createElement("div");
    body.className = "card-body";

    const header = document.createElement("div");
    header.className = "card-header";

    if (info.isLeader) {
      const leader = document.createElement("span");
      leader.className = "leader-mark";
      leader.title = "リーダー";
      leader.textContent = "★";
      header.appendChild(leader);
    }

    const name = document.createElement("div");
    name.className = "card-name";
    name.textContent = info.name;
    header.appendChild(name);

    const time = document.createElement("div");
    time.className = "card-time";
    const meta = fmtRange(info.start, info.end);
    time.textContent = meta || "時間未設定";

    const memo = document.createElement("div");
    memo.className = "card-memo hint";
    memo.textContent = info.memo ? `備考: ${info.memo}` : "備考: -";

    const employment = document.createElement("div");
    employment.className = "employment-count";
    employment.innerHTML = `<span class="count">${Number(
      info.employmentCount || 0
    )}</span><span class="unit">回</span>`;

    const metaRow = document.createElement("div");
    metaRow.className = "card-meta-row";
    metaRow.appendChild(memo);
    metaRow.appendChild(employment);

    body.appendChild(header);
    body.appendChild(time);
    body.appendChild(metaRow);

    return body;
  }

  function createPlacedCard(info, workerId, areaId, assignmentId, floorId) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.type = "placed";
    card.dataset.assignmentId = assignmentId;
    card.dataset.workerId = workerId;
    card.dataset.areaId = areaId;
    card.dataset.floorId = floorId || "";
    card.setAttribute("draggable", "true");

    applyAccent(card, info.panelColor);

    const { left, right } = createSkillColumns(
      _skillSettings,
      normalizeSkillLevels(info.skillLevels)
    );
    const body = buildCardBody(info, areaId, floorId);

    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.className = "card-action";
    settingsBtn.dataset.action = "edit-worker";
    settingsBtn.title = "作業員情報を編集";
    settingsBtn.textContent = "⚙";

    card.appendChild(left);
    card.appendChild(body);
    card.appendChild(right);
    card.appendChild(settingsBtn);

    return card;
  }

  function notifyMissingContext() {
    console.warn("[Floor] action blocked due to missing context", currentSite);
    toast("サイト情報が不足しているため操作できません", "error");
  }

  function handleActionError(kind, err) {
    console.error(`[Floor] ${kind}`, err);
    toast(kind, "error");
  }

  function addSlot(dropEl, workerId, areaId, assignmentId, floorId, order = 0) {
    const slot = document.createElement("div");
    slot.className = "slot";
    const info = getWorkerInfo(workerId);
    const card = createPlacedCard(info, workerId, areaId, assignmentId, floorId);
    if (!card) return;
    card.dataset.order = String(order);
    const settingsBtn = card.querySelector('[data-action="edit-worker"]');
    if (settingsBtn) {
      settingsBtn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (typeof onEditWorker === "function") {
          onEditWorker(card.dataset.workerId);
        }
      });
    }
    // DnD: フロア内移動（エリア間）
    toggleCardMode(card);
    card.addEventListener("dragstart", (e) => {
      if (_readOnly) {
        e.preventDefault();
        return;
      }
      dragStates.set(card.dataset.assignmentId, { handled: false });
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = "move";
      }
      e.dataTransfer.setData("type", "placed");
      e.dataTransfer.setData("workerId", card.dataset.workerId);
      e.dataTransfer.setData("assignmentId", card.dataset.assignmentId);
      e.dataTransfer.setData("fromAreaId", card.dataset.areaId);
      e.dataTransfer.setData("fromFloorId", card.dataset.floorId || "");
    });
    card.addEventListener("dragend", async (e) => {
      const assignmentId = card.dataset.assignmentId;
      const state = dragStates.get(assignmentId);
      dragStates.delete(assignmentId);
      clearActivePlaceholder();
      const dropEffect = e.dataTransfer?.dropEffect;
      const droppedOutside = !state?.handled && dropEffect !== "move";
      if (_readOnly || !droppedOutside) return;
      if (!currentSite?.userId || !currentSite?.siteId) {
        notifyMissingContext();
        return;
      }
      try {
        console.info("[Floor] closing assignment via outside drop", {
          assignmentId
        });
        await closeAssignment({
          userId: currentSite.userId,
          siteId: currentSite.siteId,
          assignmentId
        });
      } catch (err) {
        handleActionError("在籍のOUT処理に失敗しました", err);
      }
    });
    slot.appendChild(card);
    dropEl.appendChild(slot);
  }

  // ドロップターゲット（エリア）
  function setupDropzone(drop) {
    if (!drop || drop.dataset.bound === "true") return;
    drop.dataset.bound = "true";
    const zone = drop.closest(".zone");
    drop.addEventListener("dragover", (e) => {
      if (_readOnly) return;
      e.preventDefault();
      zone?.classList.add("dragover");
      const insertIndex = findInsertIndex(drop, e.clientY);
      showPlaceholder(drop, insertIndex);
    });
    drop.addEventListener("dragleave", (e) => {
      if (!drop.contains(e.relatedTarget)) {
        removePlaceholder(drop);
        zone?.classList.remove("dragover");
      }
    });
    drop.addEventListener("drop", async (e) => {
      zone?.classList.remove("dragover");
      if (_readOnly) {
        e.preventDefault();
        return;
      }
      clearActivePlaceholder();
      e.preventDefault();
      const type = e.dataTransfer.getData("type");
      const areaId = drop.dataset.areaId;
      const dropFloorId = drop.dataset.floorId || currentSite.floorId || "";
      const isFallback = drop.dataset.fallback === "true";
      const targetAreaId = isFallback ? FALLBACK_AREA_ID : normalizeAreaId(areaId);
      const insertIndex = findInsertIndex(drop, e.clientY);
      if (!currentSite?.userId || !currentSite?.siteId) {
        notifyMissingContext();
        return;
      }
      if (type === "pool") {
        if (isFallback) {
          toast("未割当エリアには直接配置できません", "error");
          return;
        }
        // 未配置 → IN
        const workerId = e.dataTransfer.getData("workerId");
        const isLeader =
          typeof getLeaderFlag === "function" ? Boolean(getLeaderFlag(workerId)) : false;
        const existing = getAreaAssignments(targetAreaId, dropFloorId);
        const boundedIndex = Math.max(0, Math.min(insertIndex, existing.length));
        const updates = existing.map((row, idx) => ({
          assignmentId: row.id,
          areaId: targetAreaId,
          floorId: dropFloorId,
          order: idx >= boundedIndex ? idx + 1 : idx
        }));
        if (updates.length) {
          const orderMap = new Map(updates.map((u) => [u.assignmentId, u.order]));
          currentAssignments = currentAssignments.map((row) =>
            orderMap.has(row.id) ? { ...row, order: orderMap.get(row.id) } : row
          );
          renderAssignments();
        }
        console.info("[Floor] creating assignment", {
          workerId,
          areaId,
          floorId: dropFloorId,
          isLeader
        });
        try {
          await persistOrders(updates);
          await createAssignment({
            userId: currentSite.userId,
            siteId: currentSite.siteId,
            floorId: dropFloorId,
            areaId: targetAreaId,
            workerId,
            isLeader,
            order: boundedIndex
          });
        } catch (err) {
          handleActionError("配置の登録に失敗しました", err);
        }
      } else if (type === "placed") {
        const assignmentId = e.dataTransfer.getData("assignmentId");
        const state = dragStates.get(assignmentId);
        if (state) state.handled = true;
        const workerId = e.dataTransfer.getData("workerId");
        const from = normalizeAreaId(e.dataTransfer.getData("fromAreaId"));
        const fromFloor = e.dataTransfer.getData("fromFloorId") || "";
        const sourceKey = areaKey(from, fromFloor);
        const targetKey = areaKey(targetAreaId, dropFloorId);
        const assignmentsByArea = groupAssignments();
        const movingRow = currentAssignments.find((row) => row.id === assignmentId);
        const originalTarget = sortAssignments(assignmentsByArea.get(targetKey) || []);
        const sourceList = sortAssignments(assignmentsByArea.get(sourceKey) || []).filter(
          (row) => row.id !== assignmentId
        );
        const targetList = sortAssignments(assignmentsByArea.get(targetKey) || []).filter(
          (row) => row.id !== assignmentId
        );
        const boundedIndex = Math.max(0, Math.min(insertIndex, targetList.length));
        const movingEntry = movingRow
          ? { ...movingRow, areaId: targetAreaId, floorId: dropFloorId }
          : {
              id: assignmentId,
              workerId,
              areaId: targetAreaId,
              floorId: dropFloorId
            };
        targetList.splice(boundedIndex, 0, movingEntry);

        const updates = [];
        if (targetKey === sourceKey) {
          const unchanged =
            originalTarget.length === targetList.length &&
            originalTarget.every((row, idx) => row.id === targetList[idx].id);
          if (unchanged) return;
        }
        targetList.forEach((row, idx) => {
          updates.push({
            assignmentId: row.id,
            areaId: row.areaId || targetAreaId,
            floorId: row.floorId || dropFloorId,
            order: idx
          });
        });
        if (targetKey !== sourceKey) {
          sourceList.forEach((row, idx) => {
            updates.push({
              assignmentId: row.id,
              areaId: row.areaId || from,
              floorId: row.floorId || fromFloor,
              order: idx
            });
          });
        }

        if (updates.length === 0) return;

        const nextMap = new Map(assignmentsByArea);
        nextMap.set(sourceKey, sourceList);
        nextMap.set(targetKey, targetList);
        const merged = [];
        nextMap.forEach((list = []) => merged.push(...list));
        currentAssignments = merged;
        renderAssignments();

        console.info("[Floor] updating assignment area and order", {
          assignmentId,
          workerId,
          from,
          fromFloor,
          toFloor: dropFloorId,
          to: targetAreaId,
          updates
        });
        await persistOrders(updates, "配置エリアの更新に失敗しました");
      }
    });
  }

  function bindDropzones() {
    zonesEl.querySelectorAll(".droparea").forEach((drop) => {
      setupDropzone(drop);
    });
  }

  // 外部（Dashboard）から呼ばれる：在籍スナップショットの反映
  function updateFromAssignments(rows) {
    currentAssignments = Array.isArray(rows) ? rows.slice() : [];
    renderAssignments();
  }

  function renderAssignments() {
    zonesEl.querySelectorAll(".droparea").forEach((d) => (d.innerHTML = ""));
    fallbackZoneEls.forEach((zone) => {
      const drop = zone.querySelector(
        `.droparea[data-area-id="${FALLBACK_AREA_ID}"]`
      );
      if (drop) drop.innerHTML = "";
    });
    const activeFallbackFloors = new Set();
    const normalizedAssignments = (currentAssignments || []).map((r) => ({
      ...r,
      areaId: normalizeAreaId(r.areaId),
      floorId: r.floorId || currentSite.floorId || _areas[0]?.floorId || ""
    }));

    const grouped = groupAssignments(normalizedAssignments);
    grouped.forEach((list = []) => {
      const sorted = sortAssignments(list);
      if (!sorted.length) return;
      const areaId = sorted[0].areaId || FALLBACK_AREA_ID;
      const floorId = sorted[0].floorId || "";
      let drop = zonesEl.querySelector(
        `.droparea[data-area-id="${areaId}"][data-floor-id="${floorId}"]`
      );
      let targetAreaId = areaId;
      if (!drop && _showFallback) {
        targetAreaId = FALLBACK_AREA_ID;
      }
      if (targetAreaId === FALLBACK_AREA_ID && _showFallback) {
        drop = ensureFallbackZone(floorId);
        activeFallbackFloors.add(floorId || "__none__");
      }
      const areaMeta = _areas.find(
        (a) => a.id === targetAreaId && (a.floorId || "") === (floorId || "")
      );
      applyDropLayout(drop, areaMeta || { floorId });
      if (!drop) return;
      sorted.forEach((r, idx) => {
        const order = typeof r.order === "number" ? r.order : idx;
        addSlot(drop, r.workerId, targetAreaId, r.id, floorId, order);
      });
    });
    if (_showFallback) {
      cleanupFallbackZones(activeFallbackFloors);
    } else {
      cleanupFallbackZones(new Set());
    }
  }

  // 外部（Dashboard）から呼ばれる：workerMapを差し替え→色・時間・表示を更新
  function setWorkerMap(map) {
    _workerMap = new Map(map || []);
    renderAssignments();
  }

  function toggleCardMode(card) {
    if (!card) return;
    if (_readOnly) {
      card.classList.add("readonly");
      card.setAttribute("draggable", "false");
    } else {
      card.classList.remove("readonly");
      card.setAttribute("draggable", "true");
    }
  }

  function setAreas(list) {
    const payload = normalizeAreaPayload(list);
    _areas = normalizeAreas(payload.areas);
    _layout = payload.layout;
    _layoutMap = payload.layouts;
    renderZones();
    renderAssignments();
  }

  function setReadOnly(flag) {
    _readOnly = Boolean(flag);
    renderAssignments();
  }

  function setSite(nextSite = {}) {
    currentSite = { ...currentSite, ...nextSite };
  }

  function setSkillSettings(settings = DEFAULT_SKILL_SETTINGS) {
    _skillSettings = settings || DEFAULT_SKILL_SETTINGS;
    renderAssignments();
  }

  function setFallbackVisibility(flag = true) {
    _showFallback = Boolean(flag);
    renderAssignments();
  }

  function renderZones() {
    zonesEl.innerHTML = "";
    fallbackZoneEls = new Map();
    applyGridTemplate();
    _areas.forEach((area) => {
      const zone = document.createElement("div");
      zone.className = "zone";
      zone.dataset.floorId = area.floorId || "";
      zone.dataset.areaId = area.id;
      applyAreaLayout(zone, area);
      const title = document.createElement("h3");
      const floorLabel = area.floorLabel || getFloorLabel(area.floorId);
      title.textContent = floorLabel
        ? `${floorLabel}：${area.label || `エリア${area.id}`}`
        : area.label || `エリア${area.id}`;
      const drop = document.createElement("div");
      drop.className = "droparea";
      drop.dataset.areaId = area.id;
      drop.dataset.floorId = area.floorId || "";
      applyDropLayout(drop, area);
      zone.appendChild(title);
      zone.appendChild(drop);
      zonesEl.appendChild(zone);
    });
    bindDropzones();
  }

  function ensureFallbackZone(floorId) {
    const key = floorId || "__none__";
    if (fallbackZoneEls.has(key)) {
      const zone = fallbackZoneEls.get(key);
      const drop = zone?.querySelector(
        `.droparea[data-area-id="${FALLBACK_AREA_ID}"]`
      );
      if (drop) {
        applyDropLayout(drop, { floorId });
        drop.innerHTML = "";
        setupDropzone(drop);
        return drop;
      }
    }
    const zone = document.createElement("div");
    zone.className = "zone fallback";
    zone.dataset.areaId = FALLBACK_AREA_ID;
    zone.dataset.floorId = floorId || "";
    const title = document.createElement("h3");
    const floorLabel = getFloorLabel(floorId);
    title.textContent = floorLabel
      ? `${floorLabel}：${FALLBACK_AREA_LABEL}`
      : FALLBACK_AREA_LABEL;
    const drop = document.createElement("div");
    drop.className = "droparea";
    drop.dataset.areaId = FALLBACK_AREA_ID;
    drop.dataset.fallback = "true";
    drop.dataset.floorId = floorId || "";
    applyDropLayout(drop, { floorId });
    zone.appendChild(title);
    zone.appendChild(drop);
    zonesEl.appendChild(zone);
    fallbackZoneEls.set(key, zone);
    setupDropzone(drop);
    return drop;
  }

  function cleanupFallbackZones(activeFloors = new Set()) {
    const removeKeys = [];
    fallbackZoneEls.forEach((zone, key) => {
      if (activeFloors.has(key)) return;
      if (zone?.parentNode) {
        zone.parentNode.removeChild(zone);
      }
      removeKeys.push(key);
    });
    removeKeys.forEach((k) => fallbackZoneEls.delete(k));
  }

  function normalizeAreas(list) {
    if (!Array.isArray(list)) return DEFAULT_AREAS.slice();
    return list
      .map((a, idx) => ({
        id: a.id || a.areaId || `Z${idx + 1}`,
        label: a.label || a.name || `エリア${a.id || idx + 1}`,
        order: typeof a.order === "number" ? a.order : idx,
        floorId: a.floorId || "",
        floorLabel: a.floorLabel || "",
        floorOrder: typeof a.floorOrder === "number" ? a.floorOrder : 0,
        gridRow: toPositiveInt(a.gridRow || a.row),
        gridColumn: toPositiveInt(a.gridColumn || a.column),
        rowSpan: toPositiveInt(a.rowSpan || a.gridRowSpan),
        colSpan: toPositiveInt(a.colSpan || a.gridColSpan),
        columns: toPositiveInt(a.columns),
        minWidth: toPositiveInt(a.minWidth)
      }))
      .filter((a) => a.id && a.id !== FALLBACK_AREA_ID)
      .sort((a, b) => {
        const floorOrderDiff = (a.floorOrder ?? 0) - (b.floorOrder ?? 0);
        if (floorOrderDiff !== 0) return floorOrderDiff;
        return (a.order ?? 0) - (b.order ?? 0);
      });
  }

  function normalizeLayout(layout = {}) {
    const columns = toPositiveInt(layout.columns);
    return { columns: columns && columns > 0 && columns <= 12 ? columns : 0 };
  }

  function normalizeAreaPayload(input) {
    if (Array.isArray(input)) {
      return { areas: input, layout: normalizeLayout(), layouts: new Map() };
    }
    const areasList = Array.isArray(input?.areas) ? input.areas : DEFAULT_AREAS;
    const layout = normalizeLayout(input?.layout || {});
    const providedLayouts = input?.layouts instanceof Map ? input.layouts : new Map();
    const layouts = new Map();
    providedLayouts.forEach((value, key) => {
      layouts.set(key, normalizeLayout(value));
    });
    return { areas: areasList, layout, layouts };
  }

  function getLayoutForFloor(floorId) {
    return _layoutMap.get(floorId) || _layout || { columns: 0 };
  }

  function extractDropColumns(area) {
    const areaColumns = toPositiveInt(area?.columns);
    if (areaColumns) return areaColumns;

    const legacyColumns =
      toPositiveInt(area?.dropColumns) || toPositiveInt(area?.dropLayout?.columns);
    if (legacyColumns) return legacyColumns;

    const layout = getLayoutForFloor(area?.floorId);
    return toPositiveInt(layout?.columns);
  }

  function getDropColumns(area) {
    const columns = extractDropColumns(area);
    return columns || 2;
  }

  function getDropMinWidth(area) {
    const explicit = toPositiveInt(area?.minWidth);
    if (explicit) return explicit;
    const dropColumns = getDropColumns(area);
    const zoneBaseWidth = 260; // align with --zone-columns min width
    if (dropColumns <= 1) return zoneBaseWidth;
    const minWidth = Math.floor(zoneBaseWidth / dropColumns);
    return Math.max(120, minWidth);
  }

  function applyDropLayout(dropEl, area) {
    if (!dropEl) return;
    dropEl.style.setProperty("--drop-columns", `${getDropColumns(area)}`);
    dropEl.style.setProperty("--drop-min-width", `${getDropMinWidth(area)}px`);
  }

  function applyGridTemplate() {
    const uniqueColumns = new Set();
    _layoutMap.forEach((layout) => {
      if (layout?.columns) uniqueColumns.add(layout.columns);
    });
    if (_layout?.columns) {
      uniqueColumns.add(_layout.columns);
    }
    const columns = uniqueColumns.size === 1 ? uniqueColumns.values().next().value : 0;
    const template = columns
      ? `repeat(${columns}, minmax(260px, 1fr))`
      : "repeat(auto-fit,minmax(260px,1fr))";
    zonesEl.style.setProperty("--zone-columns", template);
  }

  function applyAreaLayout(zone, area) {
    if (!zone || !area) return;
    const { gridRow, gridColumn, rowSpan, colSpan } = area;
    zone.style.gridRowStart = gridRow ? `${gridRow}` : "";
    zone.style.gridColumnStart = gridColumn ? `${gridColumn}` : "";
    zone.style.gridRowEnd = rowSpan ? `span ${rowSpan}` : "";
    zone.style.gridColumnEnd = colSpan ? `span ${colSpan}` : "";
  }

  // グローバルフック（既存実装がこれを呼ぶ）
  const api = {
    updateFromAssignments,
    setWorkerMap,
    setAreas,
    setReadOnly,
    setSite,
    setSkillSettings,
    setFallbackVisibility
  };
  window.__floorRender = api;

  // アンマウント
  api.unmount = () => {
    if (window.__floorRender) delete window.__floorRender;
    mount.innerHTML = "";
  };
  return api;
}
