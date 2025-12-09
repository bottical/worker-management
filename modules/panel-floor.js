// modules/panel-floor.js
import {
  createAssignment,
  closeAssignment,
  updateAssignmentArea,
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
  let _areas = normalizeAreas(areas);
  let _readOnly = false;
  let currentAssignments = [];
  let currentSite = { ...site };
  let _skillSettings = options.skillSettings || DEFAULT_SKILL_SETTINGS;
  let fallbackZoneEls = new Map();
  const dragStates = new Map();
  const { onEditWorker, getLeaderFlag } = options;

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

  function addSlot(dropEl, workerId, areaId, assignmentId, floorId) {
    const slot = document.createElement("div");
    slot.className = "slot";
    const info = getWorkerInfo(workerId);
    const card = createPlacedCard(info, workerId, areaId, assignmentId, floorId);
    if (!card) return;
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
        const isLeader =
          typeof getLeaderFlag === "function" ? Boolean(getLeaderFlag(workerId)) : false;
        console.info("[Floor] creating assignment", {
          workerId,
          areaId,
          floorId: dropFloorId,
          isLeader
        });
        try {
          await createAssignment({
            userId: currentSite.userId,
            siteId: currentSite.siteId,
            floorId: dropFloorId,
            areaId,
            workerId,
            isLeader
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

  function setSkillSettings(settings = DEFAULT_SKILL_SETTINGS) {
    _skillSettings = settings || DEFAULT_SKILL_SETTINGS;
    renderAssignments();
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
  const api = {
    updateFromAssignments,
    setWorkerMap,
    setAreas,
    setReadOnly,
    setSite,
    setSkillSettings
  };
  window.__floorRender = api;

  // アンマウント
  api.unmount = () => {
    if (window.__floorRender) delete window.__floorRender;
    mount.innerHTML = "";
  };
  return api;
}
