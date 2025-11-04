// modules/panel-floor.js
import {
  createAssignment,
  closeAssignment,
  DEFAULT_AREAS
} from "../api/firebase.js";
import { fmtRange } from "../core/ui.js";

/**
 * フロア（ゾーン）側の描画と、在籍の反映を担う
 * - workerMap を後から差し替え可能（色・時間の反映に対応）
 * - assignments購読から updateFromAssignments(rows) が呼ばれる前提
 */
export function makeFloor(mount, site, workerMap = new Map(), areas = DEFAULT_AREAS) {
  let _workerMap = new Map(workerMap || []);
  let _areas = normalizeAreas(areas);
  let _readOnly = false;
  let currentAssignments = [];
  let currentSite = { ...site };

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
      panelColor: w.panelColor || ""
    };
  }

  function getAreaLabel(areaId) {
    const area = _areas.find((a) => a.id === areaId);
    if (!area) return `エリア${areaId}`;
    return area.label || `エリア${area.id}`;
  }

  function slotHtml(workerId, areaId, assignmentId) {
    const info = getWorkerInfo(workerId);
    const meta = fmtRange(info.start, info.end);
    const areaLabel = getAreaLabel(areaId);
    return `
      <div class="card" draggable="true"
           data-type="placed"
           data-assignment-id="${assignmentId}"
           data-worker-id="${workerId}"
           data-area-id="${areaId}">
        <div class="avatar" style="${info.panelColor ? `background:${info.panelColor}` : ""}">
          ${info.name.charAt(0)}
        </div>
        <div>
          <div class="mono">${info.name}${meta ? ` ${meta}` : ""}</div>
          <div class="hint">配置：${areaLabel}${_readOnly ? "（閲覧）" : "（クリックでOUT）"}</div>
        </div>
      </div>
    `;
  }

  function addSlot(dropEl, workerId, areaId, assignmentId) {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.innerHTML = slotHtml(workerId, areaId, assignmentId);
    // クリックでOUT
    slot.querySelector(".card").addEventListener("click", async (e) => {
      if (_readOnly) return;
      const id = e.currentTarget.dataset.assignmentId;
      if (!currentSite?.userId || !currentSite?.siteId) {
        console.warn("closeAssignment skipped: missing user/site context");
        return;
      }
      try {
        await closeAssignment({
          userId: currentSite.userId,
          siteId: currentSite.siteId,
          assignmentId: id
        });
      } catch (err) {
        console.warn("closeAssignment failed", err);
      }
    });
    // DnD: フロア内移動（エリア間）
    const card = slot.querySelector(".card");
    toggleCardMode(card);
    card.addEventListener("dragstart", (e) => {
      if (_readOnly) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData("type", "placed");
      e.dataTransfer.setData("workerId", card.dataset.workerId);
      e.dataTransfer.setData("assignmentId", card.dataset.assignmentId);
      e.dataTransfer.setData("fromAreaId", card.dataset.areaId);
    });
    dropEl.appendChild(slot);
  }

  // ドロップターゲット（エリア）
  function bindDropzones() {
    zonesEl.querySelectorAll(".droparea").forEach((drop) => {
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
        if (!currentSite?.userId || !currentSite?.siteId) {
          console.warn("drop skipped: missing user/site context");
          return;
        }
        if (type === "pool") {
          // 未配置 → IN
          const workerId = e.dataTransfer.getData("workerId");
          try {
            await createAssignment({
              userId: currentSite.userId,
              siteId: currentSite.siteId,
              floorId: currentSite.floorId,
              areaId,
              workerId
            });
          } catch (err) {
            console.warn("createAssignment failed", err);
          }
        } else if (type === "placed") {
          // エリア間移動 = OUT → IN の簡易実装（サーバー側で同一workerのoutAtセット→新規作成）
          const assignmentId = e.dataTransfer.getData("assignmentId");
          const workerId = e.dataTransfer.getData("workerId");
          const from = e.dataTransfer.getData("fromAreaId");
          if (from === areaId) return; // 同一エリアなら何もしない
          try {
            await closeAssignment({
              userId: currentSite.userId,
              siteId: currentSite.siteId,
              assignmentId
            });
            await createAssignment({
              userId: currentSite.userId,
              siteId: currentSite.siteId,
              floorId: currentSite.floorId,
              areaId,
              workerId
            });
          } catch (err) {
            console.warn("move (close+create) failed", err);
          }
        }
      });
    });
  }

  // 外部（Dashboard）から呼ばれる：在籍スナップショットの反映
  function updateFromAssignments(rows) {
    currentAssignments = Array.isArray(rows) ? rows.slice() : [];
    renderAssignments();
  }

  function renderAssignments() {
    zonesEl.querySelectorAll(".droparea").forEach((d) => (d.innerHTML = ""));
    currentAssignments.forEach((r) => {
      const drop = zonesEl.querySelector(`.droparea[data-area-id="${r.areaId}"]`);
      if (drop) addSlot(drop, r.workerId, r.areaId, r.id);
    });
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
        av.style.background = info.panelColor || "";
        av.textContent = info.name.charAt(0);
      }
      const title = card.querySelector(".mono");
      if (title) {
        const meta = fmtRange(info.start, info.end);
        title.textContent = `${info.name}${meta ? ` ${meta}` : ""}`;
      }
      const hint = card.querySelector(".hint");
      if (hint) {
        const label = getAreaLabel(areaId);
        hint.textContent = `配置：${label}${_readOnly ? "（閲覧）" : "（クリックでOUT）"}`;
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
    _areas.forEach((area) => {
      const zone = document.createElement("div");
      zone.className = "zone";
      zone.dataset.areaId = area.id;
      const title = document.createElement("h3");
      title.textContent = area.label || `エリア${area.id}`;
      const drop = document.createElement("div");
      drop.className = "droparea";
      drop.dataset.areaId = area.id;
      zone.appendChild(title);
      zone.appendChild(drop);
      zonesEl.appendChild(zone);
    });
    bindDropzones();
  }

  function normalizeAreas(list) {
    if (!Array.isArray(list) || list.length === 0) return DEFAULT_AREAS.slice();
    return list
      .map((a, idx) => ({
        id: a.id || a.areaId || `Z${idx + 1}`,
        label: a.label || a.name || `エリア${a.id || idx + 1}`,
        order: typeof a.order === "number" ? a.order : idx
      }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
