// modules/panel-floor.js
import {
  createAssignment,
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
  let mentorshipMap = new Map();
  let poolDropEl = null;
  const { onEditWorker, onMentorshipChange } = options;

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

  function cleanupDragState() {
    document.body.classList.remove("dragging");
    document.querySelectorAll(".drag-overlay").forEach((el) => el.remove());
    document.documentElement.style.pointerEvents = "";
    zonesEl.querySelectorAll(".zone.dragover").forEach((zone) => {
      zone.classList.remove("dragover");
    });
    clearActivePlaceholder();
    document.removeEventListener("dragover", handleDocumentDragover, { capture: true });
  }

  const handleGlobalDragCleanup = () => {
    cleanupDragState();
  };

  const handleDocumentDragover = (e) => {
    if (_readOnly) return;
    const type = e.dataTransfer?.getData("type");
    if (type !== "placed") return;
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
  };

  const handleDocumentDropCapture = async (e) => {
    if (_readOnly) return;
    const type = e.dataTransfer?.getData("type");
    if (type !== "placed") return;

    const inZone = e.target?.closest?.(".zone");
    const inPool = poolDropEl && (e.target === poolDropEl || poolDropEl.contains(e.target));
    if (inZone || inPool) return;

    e.preventDefault();
    e.stopPropagation();
    try {
      await handleUnplaceDrop(e);
    } finally {
      cleanupDragState();
    }
  };

  const handleDocumentKeydown = (e) => {
    if (e.key === "Escape") {
      handleGlobalDragCleanup();
    }
  };

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
      skillLevels: normalizeSkillLevels(w.skillLevels)
    };
  }

  function getMentorship(workerId) {
    const info = mentorshipMap.get(workerId) || {};
    return {
      mentorId: info.mentorId || "",
      groupOrder: typeof info.groupOrder === "number" ? info.groupOrder : 0,
      areaId: info.areaId || "",
      floorId: info.floorId || ""
    };
  }

  function getMenteesInArea(mentorId, areaId, floorId) {
    const normalizedArea = normalizeAreaId(areaId);
    const normalizedFloor = floorId || "";
    return currentAssignments.filter((row) => {
      const meta = getMentorship(row.workerId);
      return (
        meta.mentorId === mentorId &&
        normalizeAreaId(meta.areaId || row.areaId) === normalizedArea &&
        (meta.floorId || row.floorId || "") === normalizedFloor
      );
    });
  }

  function wouldCreateCycle(workerId, mentorId) {
    if (!workerId || !mentorId) return false;
    let current = mentorId;
    const visited = new Set([workerId]);
    while (current) {
      if (visited.has(current)) return true;
      visited.add(current);
      const next = getMentorship(current).mentorId;
      if (!next) break;
      current = next;
    }
    return false;
  }

  function getNextGroupOrder(mentorId, areaId, floorId) {
    const mentees = getMenteesInArea(mentorId, areaId, floorId);
    if (!mentees.length) return 0;
    const maxOrder = Math.max(
      ...mentees.map((row) => getMentorship(row.workerId).groupOrder || 0)
    );
    return maxOrder + 1;
  }

  function buildGroupOrderUpdates(assignments = [], areaId = "", floorId = "") {
    const normalizedArea = normalizeAreaId(areaId);
    const normalizedFloor = floorId || "";
    const counters = new Map();
    const updates = [];
    assignments.forEach((row) => {
      const meta = getMentorship(row.workerId);
      const metaArea = normalizeAreaId(meta.areaId || row.areaId);
      const metaFloor = meta.floorId || row.floorId || "";
      if (!meta.mentorId) return;
      if (metaArea !== normalizedArea || metaFloor !== normalizedFloor) return;
      const key = `${meta.mentorId}__${metaArea}__${metaFloor}`;
      const nextOrder = counters.get(key) || 0;
      counters.set(key, nextOrder + 1);
      if (meta.groupOrder !== nextOrder) {
        updates.push({
          workerId: row.workerId,
          mentorId: meta.mentorId,
          areaId: metaArea,
          floorId: metaFloor,
          groupOrder: nextOrder
        });
      }
    });
    return updates;
  }

  async function applyMentorshipUpdates(updates = []) {
    for (const payload of updates) {
      await requestMentorshipChange(payload);
    }
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

  function parseHour(value) {
    if (!value || typeof value !== "string") return null;
    const [hour] = value.split(":");
    const parsed = Number.parseInt(hour, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function normalizeTimeRules(timeRules = {}) {
    if (!timeRules || typeof timeRules !== "object") {
      return { startRules: [], endRules: [] };
    }
    const startRules = Array.isArray(timeRules.startRules) ? timeRules.startRules : [];
    const endRules = Array.isArray(timeRules.endRules) ? timeRules.endRules : [];
    const fallbackStart = timeRules.startHour ? [timeRules.startHour] : [];
    const fallbackEnd = timeRules.endHour ? [timeRules.endHour] : [];
    return {
      startRules: startRules.length ? startRules : fallbackStart,
      endRules: endRules.length ? endRules : fallbackEnd
    };
  }

  function findRuleColor(rules, hour) {
    if (hour === null) return null;
    for (const rule of rules) {
      if (rule && typeof rule.hour === "number" && rule.hour === hour) {
        return rule.color;
      }
    }
    return null;
  }

  function buildCardBody(info, areaId, floorId, timeNotes = {}) {
    const body = document.createElement("div");
    body.className = "card-body";

    const header = document.createElement("div");
    header.className = "card-header";

    const name = document.createElement("div");
    name.className = "card-name";
    name.textContent = info.name;
    header.appendChild(name);

    const timeRow = document.createElement("div");
    timeRow.className = "card-time-row";

    const leftNote = document.createElement("span");
    leftNote.className = "card-time-note left";
    const rightNote = document.createElement("span");
    rightNote.className = "card-time-note right";

    const time = document.createElement("div");
    time.className = "card-time";
    const meta = fmtRange(info.start, info.end);
    time.textContent = meta || "時間未設定";
    const timeRules = normalizeTimeRules(_skillSettings?.timeRules || {});
    const startHour = parseHour(info.start);
    const endHour = parseHour(info.end);
    const startColor = findRuleColor(timeRules.startRules, startHour);
    if (startColor) {
      time.style.background = startColor;
    }
    const endColor = findRuleColor(timeRules.endRules, endHour);
    if (endColor) {
      time.style.background = endColor;
    }

    const normalizedLeft =
      typeof timeNotes.timeNoteLeft === "string" ? timeNotes.timeNoteLeft.trim() : "";
    const normalizedRight =
      typeof timeNotes.timeNoteRight === "string" ? timeNotes.timeNoteRight.trim() : "";
    if (normalizedLeft) {
      leftNote.textContent = normalizedLeft;
    } else {
      leftNote.style.display = "none";
    }
    if (normalizedRight) {
      rightNote.textContent = normalizedRight;
    } else {
      rightNote.style.display = "none";
    }

    timeRow.appendChild(leftNote);
    timeRow.appendChild(time);
    timeRow.appendChild(rightNote);

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
    body.appendChild(timeRow);
    body.appendChild(metaRow);

    return body;
  }

  function createPlacedCard(
    info,
    workerId,
    areaId,
    assignmentId,
    floorId,
    meta = {},
    timeNotes = {}
  ) {
    const { role = "solo", mentorId = "", groupOrder = 0, onDetach = null } = meta;
    const card = document.createElement("div");
    card.className = "card";
    if (role === "mentee") card.classList.add("mentee-card");
    if (role === "mentor") card.classList.add("mentor-card");
    if (mentorId) {
      card.dataset.mentorId = mentorId;
    }
    if (typeof groupOrder === "number") {
      card.dataset.groupOrder = String(groupOrder);
    }
    card.dataset.type = "placed";
    card.dataset.assignmentId = assignmentId;
    card.dataset.workerId = workerId;
    card.dataset.areaId = areaId;
    card.dataset.floorId = floorId || "";
    card.setAttribute("draggable", "true");

    if (!_readOnly && role !== "mentee") {
      card.dataset.educationHint = "他の作業員をこのカードにドロップすると教育者に設定されます";
      card.title = "他の作業員をドラッグ＆ドロップで教育者に設定";
    }

    applyAccent(card, info.panelColor);

    const { left, right } = createSkillColumns(
      _skillSettings,
      normalizeSkillLevels(info.skillLevels)
    );
    const body = buildCardBody(info, areaId, floorId, timeNotes);

    let detachBtn = null;
    if (role === "mentee") {
      if (typeof onDetach === "function") {
        detachBtn = document.createElement("button");
        detachBtn.type = "button";
        detachBtn.className = "mentee-detach";
        detachBtn.title = "教育関係を解除";
        detachBtn.textContent = "×";
        detachBtn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          onDetach();
        });
      }
    }

    const settingsBtn = document.createElement("button");
    settingsBtn.type = "button";
    settingsBtn.className = "card-action";
    settingsBtn.dataset.action = "edit-worker";
    settingsBtn.title = "作業員情報を編集";
    settingsBtn.textContent = "⚙";

    card.appendChild(left);
    card.appendChild(body);
    card.appendChild(right);
    if (detachBtn) {
      card.appendChild(detachBtn);
    }
    card.appendChild(settingsBtn);

    if (role !== "mentee") {
      const isDraggingPlaced = () => {
        const dragging = document.querySelector(".card.dragging");
        if (!dragging) return false;
        if (dragging.classList.contains("placed-card")) return true;
        if (dragging.classList.contains("mentee-card")) return true;
        if (dragging.dataset?.type === "placed") return true;
        return false;
      };

      card.addEventListener("dragenter", (e) => {
        if (_readOnly) return;
        if (!isDraggingPlaced()) return;
        e.preventDefault();
        card.classList.add("mentor-drop-target");
      });
      card.addEventListener("dragover", (e) => {
        if (_readOnly) return;
        if (!isDraggingPlaced()) return;
        e.preventDefault();
        card.classList.add("mentor-drop-target");
      });
      card.addEventListener("dragleave", (e) => {
        // 子要素間の移動では外さない
        if (card.contains(e.relatedTarget)) return;
        card.classList.remove("mentor-drop-target");
      });
      card.addEventListener("drop", (e) => {
        card.classList.remove("mentor-drop-target");
        if (_readOnly) return;
        const menteeId = e.dataTransfer.getData("workerId");
        const fromArea = normalizeAreaId(e.dataTransfer.getData("fromAreaId"));
        const fromFloor = e.dataTransfer.getData("fromFloorId") || "";
        const targetArea = normalizeAreaId(areaId);
        const targetFloor = floorId || "";
        if (!menteeId) return;
        if (menteeId === workerId) {
          toast("自分自身を教育者に設定できません", "error");
          return;
        }
        if (fromArea !== targetArea || fromFloor !== targetFloor) {
          toast("同一エリア内のみ紐づけできます", "error");
          return;
        }
        if (wouldCreateCycle(menteeId, workerId)) {
          toast("循環する教育関係は設定できません", "error");
          return;
        }
        const groupOrder = getNextGroupOrder(workerId, targetArea, targetFloor);
        requestMentorshipChange({
          workerId: menteeId,
          mentorId: workerId,
          areaId: targetArea,
          floorId: targetFloor,
          groupOrder
        });
        e.stopPropagation();
        e.preventDefault();
      });
    }

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

  async function requestMentorshipChange({
    workerId,
    mentorId = "",
    areaId = "",
    floorId = "",
    groupOrder = 0
  }) {
    if (_readOnly) {
      toast("過去日は編集できません", "error");
      return;
    }
    if (typeof onMentorshipChange !== "function") return;
    const previous = getMentorship(workerId);
    mentorshipMap.set(workerId, {
      mentorId: mentorId || "",
      groupOrder: typeof groupOrder === "number" ? groupOrder : 0,
      areaId: areaId || previous.areaId || "",
      floorId: floorId || previous.floorId || ""
    });
    renderAssignments();
    try {
      await onMentorshipChange({
        workerId,
        mentorId,
        areaId,
        floorId,
        groupOrder
      });
    } catch (err) {
      mentorshipMap.set(workerId, previous);
      renderAssignments();
      handleActionError("教育関係の更新に失敗しました", err);
    }
  }

  function addSlot(
    dropEl,
    workerId,
    areaId,
    assignmentId,
    floorId,
    order = 0,
    meta = {},
    timeNotes = {}
  ) {
    const slot = document.createElement("div");
    slot.className = "slot";
    const info = getWorkerInfo(workerId);
    const card = createPlacedCard(
      info,
      workerId,
      areaId,
      assignmentId,
      floorId,
      meta,
      timeNotes
    );
    if (!card) return;
    if (meta.inPool) {
      card.classList.add("in-pool");
    }
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
      card.classList.add("dragging");
      document.body.classList.add("dragging");
      const { dataTransfer } = e;
      dragStates.set(card.dataset.assignmentId, { handled: false });
      if (dataTransfer) {
        dataTransfer.effectAllowed = "move";
        dataTransfer.setData("type", "placed");
        dataTransfer.setData("workerId", card.dataset.workerId);
        dataTransfer.setData("assignmentId", card.dataset.assignmentId);
        dataTransfer.setData("fromAreaId", card.dataset.areaId);
        dataTransfer.setData("fromFloorId", card.dataset.floorId || "");
        dataTransfer.setData("text/plain", "placed");
      }
      document.addEventListener("dragover", handleDocumentDragover, { capture: true });
    });
    card.addEventListener("dragend", async (e) => {
      card.classList.remove("dragging");
      const assignmentId = card.dataset.assignmentId;
      const state = dragStates.get(assignmentId);
      dragStates.delete(assignmentId);
      clearActivePlaceholder();
      if (!state?.handled) {
        cleanupDragState();
      }
    });
    slot.appendChild(card);
    dropEl.appendChild(slot);
  }

  // ドロップターゲット（エリア）
  function resolveDropContext(e) {
    let el = e.target?.closest?.("[data-area-id], .zone");
    if (!el) {
      const under = document.elementFromPoint(e.clientX, e.clientY);
      el = under?.closest?.("[data-area-id], .zone");
    }
    const zone = el?.classList?.contains("zone") ? el : el?.closest?.(".zone");
    if (!zone) return null;
    const drop = zone.querySelector(".droparea");
    if (!drop) return null;
    return { zone, drop };
  }

  async function handleAreaDrop(e, drop) {
    const zone = drop.closest(".zone");
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
        timeNoteLeft: "",
        timeNoteRight: ""
      });
      try {
        await persistOrders(updates);
        await createAssignment({
          userId: currentSite.userId,
          siteId: currentSite.siteId,
          floorId: dropFloorId,
          areaId: targetAreaId,
          workerId,
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
        ? {
            ...movingRow,
            areaId: targetAreaId,
            floorId: dropFloorId,
            updatedAt: Date.now()
          }
        : {
            id: assignmentId,
            workerId,
            areaId: targetAreaId,
            floorId: dropFloorId,
            updatedAt: Date.now()
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
      const mentorship = getMentorship(workerId);
      const normalizedFrom = normalizeAreaId(from);
      const normalizedTarget = normalizeAreaId(targetAreaId);
      const isSameSpot =
        normalizedFrom === normalizedTarget && (fromFloor || "") === (dropFloorId || "");
      const shouldDetachMentorship = mentorship.mentorId && !isSameSpot;
      if (shouldDetachMentorship) {
        await requestMentorshipChange({
          workerId,
          mentorId: "",
          areaId: targetAreaId,
          floorId: dropFloorId,
          groupOrder: 0
        });
      }
      let groupOrderUpdates = buildGroupOrderUpdates(
        targetList,
        targetAreaId,
        dropFloorId
      );
      if (targetKey !== sourceKey) {
        groupOrderUpdates.push(...buildGroupOrderUpdates(sourceList, from, fromFloor));
      }
      if (shouldDetachMentorship) {
        groupOrderUpdates = groupOrderUpdates.filter(
          (update) => update.workerId !== workerId
        );
      }
      if (groupOrderUpdates.length) {
        await applyMentorshipUpdates(groupOrderUpdates);
      }
    }
  }

  async function handleUnplaceDrop(e) {
    if (_readOnly) {
      e.preventDefault();
      return;
    }
    e.preventDefault();
    console.info("[DnD] handleUnplaceDrop fired", {
      type: e.dataTransfer?.getData("type"),
      assignmentId: e.dataTransfer?.getData("assignmentId"),
      fromAreaId: e.dataTransfer?.getData("fromAreaId"),
      fromFloorId: e.dataTransfer?.getData("fromFloorId")
    });
    const type = e.dataTransfer?.getData("type");
    if (type !== "placed") return;
    const assignmentId = e.dataTransfer.getData("assignmentId");
    const fromAreaId = e.dataTransfer.getData("fromAreaId");
    const fromFloorId = e.dataTransfer.getData("fromFloorId");
    if (!assignmentId) return;
    const state = dragStates.get(assignmentId);
    if (state) state.handled = true;
    if (!currentSite?.userId || !currentSite?.siteId) {
      notifyMissingContext();
      return;
    }
    const movingRow = currentAssignments.find((row) => row.id === assignmentId);
    if (!movingRow) return;
    if (movingRow.areaId === "" || movingRow.areaId === null || movingRow.areaId === undefined) {
      return;
    }

    const fromArea = normalizeAreaId(fromAreaId || movingRow.areaId);
    const fromFloor = fromFloorId || movingRow.floorId || "";
    const poolFloorId = fromFloor || currentSite.floorId || "";
    const sourceKey = areaKey(fromArea, fromFloor);
    const assignmentsByArea = groupAssignments();
    const sourceList = sortAssignments(assignmentsByArea.get(sourceKey) || []).filter(
      (row) => row.id !== assignmentId
    );

    const unplacedList = currentAssignments.filter(
      (row) =>
        !row.areaId &&
        (row.floorId || currentSite.floorId || "") === poolFloorId &&
        row.id !== assignmentId
    );
    const maxUnplacedOrder = unplacedList.length
      ? Math.max(...unplacedList.map((row) => row.order ?? 0))
      : -1;
    const unplacedOrder = maxUnplacedOrder + 1;

    const updates = sourceList
      .map((row, idx) => ({
        assignmentId: row.id,
        areaId: row.areaId || fromArea,
        floorId: row.floorId || fromFloor,
        order: idx
      }))
      .concat({
        assignmentId,
        areaId: "",
        floorId: poolFloorId,
        order: unplacedOrder
      });

    currentAssignments = currentAssignments.map((row) =>
      row.id === assignmentId
        ? {
            ...row,
            areaId: "",
            floorId: poolFloorId,
            order: unplacedOrder,
            updatedAt: Date.now()
          }
        : row
    );
    renderAssignments();

    console.info("[Floor] unplacing assignment", {
      assignmentId,
      fromArea,
      fromFloor,
      poolFloorId,
      unplacedOrder
    });
    await persistOrders(updates, "配置の更新に失敗しました");
    const mentorship = getMentorship(movingRow.workerId);
    if (mentorship.mentorId) {
      await requestMentorshipChange({
        workerId: movingRow.workerId,
        mentorId: "",
        areaId: "",
        floorId: poolFloorId,
        groupOrder: 0
      });
    }
  }

  function setupDropzone(zone) {
    if (!zone || zone.dataset.bound === "true") return;
    zone.dataset.bound = "true";
    zone.addEventListener("dragover", (e) => {
      if (_readOnly) return;
      const context = resolveDropContext(e);
      if (!context) return;
      e.preventDefault();
      context.zone?.classList.add("dragover");
      const insertIndex = findInsertIndex(context.drop, e.clientY);
      showPlaceholder(context.drop, insertIndex);
    });
    zone.addEventListener("dragleave", (e) => {
      if (!zone.contains(e.relatedTarget)) {
        removePlaceholder(zone.querySelector(".droparea"));
        zone.classList.remove("dragover");
      }
    });
    zone.addEventListener("drop", async (e) => {
      const context = resolveDropContext(e);
      if (!context) return;
      try {
        await handleAreaDrop(e, context.drop);
      } finally {
        cleanupDragState();
      }
    });
  }

  function setupPoolDropzone(poolEl) {
    if (!poolEl || poolEl.dataset.bound === "true") return;
    poolEl.dataset.bound = "true";
    poolEl.addEventListener("dragover", (e) => {
      if (_readOnly) return;
      const type = e.dataTransfer?.getData("type");
      if (type !== "placed") return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "move";
      }
      poolEl.classList.add("dragover");
    });
    poolEl.addEventListener("dragleave", (e) => {
      if (!poolEl.contains(e.relatedTarget)) {
        poolEl.classList.remove("dragover");
      }
    });
    poolEl.addEventListener("drop", async (e) => {
      console.info("[DnD] pool drop fired", {
        target: e.target,
        type: e.dataTransfer?.getData("type")
      });
      poolEl.classList.remove("dragover");
      try {
        await handleUnplaceDrop(e);
      } catch (err) {
        handleActionError("未配置の更新に失敗しました", err);
      } finally {
        cleanupDragState();
      }
    });
  }

  function bindDropzones() {
    zonesEl.querySelectorAll(".zone").forEach((zone) => {
      setupDropzone(zone);
    });
    setupPoolDropzone(poolDropEl);
  }

  // 外部（Dashboard）から呼ばれる：在籍スナップショットの反映
  function updateFromAssignments(rows) {
    const incoming = Array.isArray(rows) ? rows.slice() : [];
    const incomingMap = new Map(incoming.map((row) => [row.id, row]));
    const localMap = new Map(currentAssignments.map((row) => [row.id, row]));
    const merged = [];
    const ids = new Set([...incomingMap.keys(), ...localMap.keys()]);
    ids.forEach((id) => {
      const incomingRow = incomingMap.get(id);
      const localRow = localMap.get(id);
      if (!incomingRow) {
        if (localRow) merged.push(localRow);
        return;
      }
      if (!localRow) {
        merged.push(incomingRow);
        return;
      }
      const incomingUpdated = timestampToMillis(incomingRow.updatedAt);
      const localUpdated = timestampToMillis(localRow.updatedAt);
      merged.push(localUpdated > incomingUpdated ? localRow : incomingRow);
    });
    currentAssignments = merged;
    renderAssignments();
  }

  function buildDisplayOrder(list = [], areaId, floorId) {
    const decorated = (list || []).map((row, idx) => ({
      ...row,
      mentorship: getMentorship(row.workerId),
      baseOrder: typeof row.order === "number" ? row.order : idx
    }));
    const idSet = new Set(decorated.map((r) => r.workerId));
    const menteesByMentor = new Map();
    decorated.forEach((row) => {
      const mentorId = row.mentorship.mentorId;
      if (!mentorId || mentorId === row.workerId || !idSet.has(mentorId)) return;
      if (!menteesByMentor.has(mentorId)) {
        menteesByMentor.set(mentorId, []);
      }
      menteesByMentor.get(mentorId).push(row);
    });
    const hasMentees = (mentorId) =>
      (menteesByMentor.get(mentorId) || []).length > 0;

    const sortedByBase = decorated.slice().sort((a, b) => a.baseOrder - b.baseOrder);
    const rendered = new Set();
    const result = [];
    const sortMentees = (list = []) => {
      return list.slice().sort((a, b) => {
        const diff = (a.mentorship.groupOrder || 0) - (b.mentorship.groupOrder || 0);
        if (diff !== 0) return diff;
        return a.baseOrder - b.baseOrder;
      });
    };
    sortedByBase.forEach((row) => {
      if (rendered.has(row.workerId)) return;
      const mentorId = row.mentorship.mentorId;
      if (hasMentees(row.workerId) && !mentorId) {
        result.push({ ...row, _role: "mentor" });
        rendered.add(row.workerId);
        const mentees = sortMentees(menteesByMentor.get(row.workerId) || []);
        mentees.forEach((mentee) => {
          if (rendered.has(mentee.workerId)) return;
          rendered.add(mentee.workerId);
          result.push({
            ...mentee,
            _role: "mentee",
            _mentorId: row.workerId,
            _mentorName: getWorkerInfo(row.workerId).name
          });
        });
        return;
      }
      if (mentorId && idSet.has(mentorId) && !rendered.has(mentorId)) {
        return;
      }
      rendered.add(row.workerId);
      result.push({
        ...row,
        _role: mentorId ? "mentee" : "solo",
        _mentorId: mentorId,
        _mentorName: mentorId ? getWorkerInfo(mentorId).name : ""
      });
    });
    return result;
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
    const assignments = currentAssignments || [];
    const fallbackFloorId = currentSite.floorId || _areas[0]?.floorId || "";
    const placedAssignments = assignments
      .filter((r) => r.areaId)
      .map((r) => ({
        ...r,
        areaId: normalizeAreaId(r.areaId),
        floorId: r.floorId || fallbackFloorId
      }));
    const unplacedAssignments = assignments
      .filter((r) => !r.areaId)
      .map((r) => ({
        ...r,
        areaId: "",
        floorId: r.floorId || fallbackFloorId
      }));

    const grouped = groupAssignments(placedAssignments);
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
      const displayList = buildDisplayOrder(sorted, targetAreaId, floorId);
      displayList.forEach((r, idx) => {
        const order = typeof r.order === "number" ? r.order : idx;
        const role = r._role || (r.mentorship?.mentorId ? "mentee" : "solo");
        const meta = {
          role,
          mentorId: r._mentorId || r.mentorship?.mentorId || "",
          groupOrder: r.mentorship?.groupOrder || 0,
          onDetach:
            role === "mentee"
              ? () =>
                  requestMentorshipChange({
                    workerId: r.workerId,
                    mentorId: "",
                    areaId: targetAreaId,
                    floorId,
                    groupOrder: 0
                  })
              : null
        };
        addSlot(drop, r.workerId, targetAreaId, r.id, floorId, order, meta, {
          timeNoteLeft: r.timeNoteLeft,
          timeNoteRight: r.timeNoteRight
        });
      });
    });
    if (_showFallback) {
      cleanupFallbackZones(activeFallbackFloors);
    } else {
      cleanupFallbackZones(new Set());
    }
    renderMentorshipLines();
  }

  function renderPool(unplaced = []) {
    if (!poolDropEl) return;
    poolDropEl.innerHTML = "";
    const sorted = sortAssignments(unplaced);
    sorted.forEach((row, idx) => {
      const order = typeof row.order === "number" ? row.order : idx;
      addSlot(poolDropEl, row.workerId, "", row.id, row.floorId, order, {
        role: "solo",
        inPool: true
      }, {
        timeNoteLeft: row.timeNoteLeft,
        timeNoteRight: row.timeNoteRight
      });
    });
  }

  function clearMentorshipLines() {
    zonesEl.querySelectorAll(".mentor-thread").forEach((line) => line.remove());
    zonesEl.querySelectorAll(".card.is-mentee").forEach((card) => {
      card.classList.remove("is-mentee");
      card.removeAttribute("data-mentor-id");
    });
  }

  function renderMentorshipLines() {
    clearMentorshipLines();
    if (!mentorshipMap || mentorshipMap.size === 0) return;

    const cards = Array.from(zonesEl.querySelectorAll(".card[data-worker-id]"));
    if (!cards.length) return;
    const cardByWorkerId = new Map(cards.map((card) => [card.dataset.workerId, card]));

    const groups = new Map();
    const LINE_WIDTH = 6;

    mentorshipMap.forEach((meta, menteeId) => {
      const mentorId = meta?.mentorId;
      if (!mentorId) return;
      const menteeCard = cardByWorkerId.get(menteeId);
      const mentorCard = cardByWorkerId.get(mentorId);
      if (!menteeCard || !mentorCard) return;
      const menteeDrop = menteeCard.closest(".droparea");
      const mentorDrop = mentorCard.closest(".droparea");
      if (!menteeDrop || !mentorDrop || menteeDrop !== mentorDrop) return;

      const key = `${mentorId}__${menteeDrop.dataset.areaId || ""}__${
        menteeDrop.dataset.floorId || ""
      }`;
      if (!groups.has(key)) {
        groups.set(key, { mentorId, drop: menteeDrop, mentees: [], mentorCard });
      } else {
        const group = groups.get(key);
        if (!group.mentorCard) {
          group.mentorCard = mentorCard;
        }
      }
      const group = groups.get(key);
      group.mentees.push({
        card: menteeCard,
        groupOrder: typeof meta?.groupOrder === "number" ? meta.groupOrder : 0
      });

      menteeCard.classList.add("is-mentee");
      menteeCard.dataset.mentorId = mentorId;
    });

    groups.forEach(({ drop, mentees, mentorId, mentorCard }) => {
      if (!drop || !mentees.length) return;
      const sorted = mentees.slice().sort((a, b) => {
        const orderDiff = a.groupOrder - b.groupOrder;
        if (orderDiff !== 0) return orderDiff;
        const rectA = a.card.getBoundingClientRect();
        const rectB = b.card.getBoundingClientRect();
        return rectA.top - rectB.top;
      });
      const cardsForBounds = [];
      if (mentorCard) {
        cardsForBounds.push(mentorCard);
      }
      sorted.forEach((item) => cardsForBounds.push(item.card));
      if (!cardsForBounds.length) return;
      const rects = cardsForBounds.map((card) => card.getBoundingClientRect());
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      const parentRect = drop.getBoundingClientRect();
      const offsetTop = top - parentRect.top + (drop.scrollTop || 0);
      const height = bottom - top;
      if (height <= 0) return;

      const thread = document.createElement("div");
      thread.className = "mentor-thread";
      thread.dataset.mentorId = mentorId;
      thread.style.top = `${offsetTop}px`;
      thread.style.height = `${height}px`;
      thread.style.width = `${LINE_WIDTH}px`;
      const lineX = getComputedStyle(drop).getPropertyValue("--mentor-line-x").trim() || "20%";
      thread.style.left = `calc(${lineX} - ${LINE_WIDTH / 2}px)`;

      drop.appendChild(thread);
    });
  }

  // 外部（Dashboard）から呼ばれる：workerMapを差し替え→色・時間・表示を更新
  function setWorkerMap(map) {
    _workerMap = new Map(map || []);
    renderAssignments();
  }

  function setMentorshipMap(map) {
    mentorshipMap = new Map(map || []);
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

  function setPoolDropzone(el) {
    poolDropEl = el;
    setupPoolDropzone(poolDropEl);
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
        setupDropzone(zone);
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
    setupDropzone(zone);
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
    setMentorshipMap,
    setAreas,
    setReadOnly,
    setSite,
    setSkillSettings,
    setFallbackVisibility,
    setPoolDropzone
  };
  window.__floorRender = api;

  zonesEl.addEventListener("dragover", (e) => {
    if (_readOnly) return;
    const type = e.dataTransfer?.getData("type");
    if (type !== "placed") return;

    // zonesEl が event target になる “隙間/余白” ケースでも、下のzoneを拾って許可する
    const context = resolveDropContext(e);
    if (context?.zone) {
      e.preventDefault();
      context.zone.classList.add("dragover");
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      // プレースホルダ表示（zone側dragover相当）
      const insertIndex = findInsertIndex(context.drop, e.clientY);
      showPlaceholder(context.drop, insertIndex);
      return;
    }

    // zoneが拾えない場合でも drop 自体は許可（後段で未配置に戻す）
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  });

  zonesEl.addEventListener("drop", async (e) => {
    console.info("[DnD] zonesEl drop fired", {
      target: e.target,
      type: e.dataTransfer?.getData("type")
    });
    if (_readOnly) {
      e.preventDefault();
      cleanupDragState();
      return;
    }
    const type = e.dataTransfer?.getData("type");
    if (type !== "placed") {
      cleanupDragState();
      return;
    }

    // まず “下にあるzone” に委譲して通常のエリアドロップとして処理
    const context = resolveDropContext(e);
    if (context?.drop) {
      try {
        await handleAreaDrop(e, context.drop);
      } finally {
        cleanupDragState();
      }
      return;
    }

    // zoneすら拾えない＝完全なエリア外（床の余白など）
    // → 未配置（pool）に戻す
    try {
      await handleUnplaceDrop(e);
    } finally {
      cleanupDragState();
    }
  });

  window.addEventListener("mouseup", handleGlobalDragCleanup);
  window.addEventListener("dragend", handleGlobalDragCleanup, true);
  window.addEventListener("drop", handleGlobalDragCleanup, true);
  window.addEventListener("blur", handleGlobalDragCleanup);
  document.addEventListener("keydown", handleDocumentKeydown);
  document.addEventListener("drop", handleDocumentDropCapture, true);
  document.addEventListener("visibilitychange", handleGlobalDragCleanup);

  // アンマウント
  api.unmount = () => {
    window.removeEventListener("mouseup", handleGlobalDragCleanup);
    window.removeEventListener("dragend", handleGlobalDragCleanup, true);
    window.removeEventListener("drop", handleGlobalDragCleanup, true);
    window.removeEventListener("blur", handleGlobalDragCleanup);
    document.removeEventListener("keydown", handleDocumentKeydown);
    document.removeEventListener("dragover", handleDocumentDragover, { capture: true });
    document.removeEventListener("drop", handleDocumentDropCapture, true);
    document.removeEventListener("visibilitychange", handleGlobalDragCleanup);
    if (window.__floorRender) delete window.__floorRender;
    mount.innerHTML = "";
  };
  return api;
}
