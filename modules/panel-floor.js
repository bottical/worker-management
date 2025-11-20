// modules/panel-floor.js
import {
  createAssignment,
  closeAssignment,
  updateAssignmentArea,
  DEFAULT_AREAS
} from "../api/firebase.js";
import { fmtRange, toast } from "../core/ui.js";
import { getContrastTextColor } from "../core/colors.js";

/**
 * フロア（ゾーン）側の描画と、在籍の反映を担う
 * - workerMap を後から差し替え可能（色・時間の反映に対応）
 * - assignments購読から updateFromAssignments(rows) が呼ばれる前提
 */
const FALLBACK_AREA_ID = "__unassigned__";
const FALLBACK_AREA_LABEL = "未割当";

export function makeFloor(mount, site, workerMap = new Map(), areas = DEFAULT_AREAS) {
  let _workerMap = new Map(workerMap || []);
  let _areas = normalizeAreas(areas);
  let _readOnly = false;
  let currentAssignments = [];
  let currentSite = { ...site };
  let fallbackZoneEls = new Map();
  const dragStates = new Map();

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
      memo: w.memo || ""
    };
  }

  function applyAvatarStyle(avatarEl, color) {
    if (!avatarEl) return;
    if (color) {
      avatarEl.style.background = color;
      avatarEl.style.color = getContrastTextColor(color);
    } else {
      avatarEl.style.background = "";
      avatarEl.style.color = "";
    }
  }

  function getFloorLabel(floorId) {
    if (!floorId) return "";
    const area = _areas.find((a) => a.floorId === floorId && a.floorLabel);
    return area?.floorLabel || floorId;
  }

  function getAreaLabel(areaId, floorId = "") {
    const area = _areas.find(
      (a) => a.id === areaId && (!floorId || a.floorId === floorId)
    );
    if (!areaId || areaId === FALLBACK_AREA_ID) return FALLBACK_AREA_LABEL;
    if (!area) return `エリア${areaId}`;
    return area.label || `エリア${area.id}`;
  }

  function slotHtml(info, workerId, areaId, assignmentId, floorId) {
    const meta = fmtRange(info.start, info.end);
    const areaLabel = getAreaLabel(areaId, floorId);
    const floorLabel = getFloorLabel(floorId);
    const locationLabel = floorLabel ? `${floorLabel} / ${areaLabel}` : areaLabel;
    const detailLines = [];
    if (typeof info.employmentCount === "number") {
      detailLines.push(`就業回数: ${info.employmentCount}回`);
    }
    if (info.memo) {
      detailLines.push(`備考: ${info.memo}`);
    }
    const detailHtml = detailLines.length
      ? detailLines.map((line) => `<div class="hint">${line}</div>`).join("")
      : "";
    return `
      <div class="card" draggable="true"
           data-type="placed"
           data-assignment-id="${assignmentId}"
           data-worker-id="${workerId}"
           data-area-id="${areaId}"
           data-floor-id="${floorId || ""}">
        <div class="avatar">
          ${info.name.charAt(0)}
        </div>
        <div>
          <div class="mono">${info.name}${meta ? ` ${meta}` : ""}</div>
          <div class="hint">配置：${locationLabel}${
      _readOnly ? "（閲覧）" : "（エリア外ドロップでOUT）"
    }</div>
          ${detailHtml}
        </div>
      </div>
    `;
  }

  function notifyMissingContext() {
    console.warn("[Floor] action blocked due to missing context", currentSite);
    toast("サイト情報が不足しているため操作できません", "error");
  }

  function handleActionError(kind, err) {
    console.error(`[Floor] ${kind}`, err);
    toast(kind, "error");
  }

  function addSlot(dropEl, workerId, areaId, assignmentId, floorId) {
    const slot = document.createElement("div");
    slot.className = "slot";
    const info = getWorkerInfo(workerId);
    slot.innerHTML = slotHtml(info, workerId, areaId, assignmentId, floorId);
    const card = slot.querySelector(".card");
    if (!card) return;
    const avatar = card.querySelector(".avatar");
    applyAvatarStyle(avatar, info.panelColor);
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
    });
    drop.addEventListener("dragleave", () => {
      zone?.classList.remove("dragover");
    });
    drop.addEventListener("drop", async (e) => {
      zone?.classList.remove("dragover");
      if (_readOnly) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      const type = e.dataTransfer.getData("type");
      const areaId = drop.dataset.areaId;
      const dropFloorId = drop.dataset.floorId || currentSite.floorId || "";
      const isFallback = drop.dataset.fallback === "true";
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
        console.info("[Floor] creating assignment", {
          workerId,
          areaId,
          floorId: dropFloorId
        });
        try {
          await createAssignment({
            userId: currentSite.userId,
            siteId: currentSite.siteId,
            floorId: dropFloorId,
            areaId,
            workerId
          });
        } catch (err) {
          handleActionError("配置の登録に失敗しました", err);
        }
      } else if (type === "placed") {
        const assignmentId = e.dataTransfer.getData("assignmentId");
        const state = dragStates.get(assignmentId);
        if (state) state.handled = true;
        const workerId = e.dataTransfer.getData("workerId");
        const from = e.dataTransfer.getData("fromAreaId");
        const fromFloor = e.dataTransfer.getData("fromFloorId");
        if (from === areaId) return; // 同一エリアなら何もしない
        console.info("[Floor] updating assignment area", {
          assignmentId,
          workerId,
          from,
          fromFloor,
          toFloor: dropFloorId,
          to: isFallback ? FALLBACK_AREA_ID : areaId
        });
        try {
          if (isFallback) {
            await updateAssignmentArea({
              userId: currentSite.userId,
              siteId: currentSite.siteId,
              assignmentId,
              areaId: FALLBACK_AREA_ID,
              floorId: dropFloorId
            });
          } else {
            await updateAssignmentArea({
              userId: currentSite.userId,
              siteId: currentSite.siteId,
              assignmentId,
              areaId,
              floorId: dropFloorId
            });
          }
        } catch (err) {
          handleActionError("配置エリアの更新に失敗しました", err);
        }
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
    currentAssignments.forEach((r) => {
      const floorId =
        r.floorId || currentSite.floorId || _areas[0]?.floorId || "";
      let targetAreaId = r.areaId || FALLBACK_AREA_ID;
      let drop = zonesEl.querySelector(
        `.droparea[data-area-id="${targetAreaId}"][data-floor-id="${floorId}"]`
      );
      if (!drop) {
        targetAreaId = FALLBACK_AREA_ID;
      }
      if (targetAreaId === FALLBACK_AREA_ID) {
        drop = ensureFallbackZone(floorId);
        activeFallbackFloors.add(floorId || "__none__");
      }
      if (drop) {
        addSlot(drop, r.workerId, targetAreaId, r.id, floorId);
      }
    });
    cleanupFallbackZones(activeFallbackFloors);
  }

  // 外部（Dashboard）から呼ばれる：workerMapを差し替え→色・時間・表示を更新
  function setWorkerMap(map) {
    _workerMap = new Map(map || []);
    // 既存スロットの見た目を更新
    mount.querySelectorAll(".slot .card").forEach((card) => {
      const workerId = card.dataset.workerId;
      const areaId = card.dataset.areaId;
      const info = getWorkerInfo(workerId);
      const av = card.querySelector(".avatar");
      if (av) {
        av.textContent = info.name.charAt(0);
        applyAvatarStyle(av, info.panelColor);
      }
      const title = card.querySelector(".mono");
      if (title) {
        const meta = fmtRange(info.start, info.end);
        title.textContent = `${info.name}${meta ? ` ${meta}` : ""}`;
      }
      const hint = card.querySelector(".hint");
      if (hint) {
        const floorId = card.dataset.floorId || "";
        const areaLabel = getAreaLabel(areaId, floorId);
        const floorLabel = getFloorLabel(floorId);
        const label = floorLabel ? `${floorLabel} / ${areaLabel}` : areaLabel;
        hint.textContent = `配置：${label}${
          _readOnly ? "（閲覧）" : "（エリア外ドロップでOUT）"
        }`;
      }
      toggleCardMode(card);
    });
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
    _areas = normalizeAreas(list);
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

  function renderZones() {
    zonesEl.innerHTML = "";
    fallbackZoneEls = new Map();
    _areas.forEach((area) => {
      const zone = document.createElement("div");
      zone.className = "zone";
      zone.dataset.floorId = area.floorId || "";
      zone.dataset.areaId = area.id;
      const title = document.createElement("h3");
      const floorLabel = area.floorLabel || getFloorLabel(area.floorId);
      title.textContent = floorLabel
        ? `${floorLabel}：${area.label || `エリア${area.id}`}`
        : area.label || `エリア${area.id}`;
      const drop = document.createElement("div");
      drop.className = "droparea";
      drop.dataset.areaId = area.id;
      drop.dataset.floorId = area.floorId || "";
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
        floorOrder: typeof a.floorOrder === "number" ? a.floorOrder : 0
      }))
      .filter((a) => a.id && a.id !== FALLBACK_AREA_ID)
      .sort((a, b) => {
        const floorOrderDiff = (a.floorOrder ?? 0) - (b.floorOrder ?? 0);
        if (floorOrderDiff !== 0) return floorOrderDiff;
        return (a.order ?? 0) - (b.order ?? 0);
      });
  }

  // グローバルフック（既存実装がこれを呼ぶ）
  const api = { updateFromAssignments, setWorkerMap, setAreas, setReadOnly, setSite };
  window.__floorRender = api;

  // アンマウント
  api.unmount = () => {
    if (window.__floorRender) delete window.__floorRender;
    mount.innerHTML = "";
  };
  return api;
}
