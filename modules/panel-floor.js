// modules/panel-floor.js
import { createAssignment, closeAssignment } from "../api/firebase.js";
import { fmtRange } from "../modules/ui.js";

/**
 * フロア（ゾーン）側の描画と、在籍の反映を担う
 * - workerMap を後から差し替え可能（色・時間の反映に対応）
 * - assignments購読から updateFromAssignments(rows) が呼ばれる前提
 */
export function makeFloor(mount, site, workerMap = new Map()) {
  // 内部で持つ（外部から setWorkerMap で置換可能）
  let _workerMap = new Map(workerMap || []);

  mount.innerHTML = `
    <div class="floor">
      <div class="area" data-area-id="A">
        <div class="area-head">エリアA</div>
        <div class="drop" data-area-id="A"></div>
      </div>
      <div class="area" data-area-id="B">
        <div class="area-head">エリアB</div>
        <div class="drop" data-area-id="B"></div>
      </div>
    </div>
  `;

  function getWorkerInfo(workerId) {
    const w = _workerMap.get(workerId) || {};
    return {
      name: w.name || workerId,
      start: w.defaultStartTime || "",
      end: w.defaultEndTime || "",
      panelColor: w.panelColor || ""
    };
  }

  function slotHtml(workerId, areaId, assignmentId) {
    const info = getWorkerInfo(workerId);
    const meta = fmtRange(info.start, info.end);
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
          <div class="hint">配置：エリア${areaId}（クリックでOUT）</div>
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
      const id = e.currentTarget.dataset.assignmentId;
      try {
        await closeAssignment(id);
      } catch (err) {
        console.warn("closeAssignment failed", err);
      }
    });
    // DnD: フロア内移動（エリア間）
    const card = slot.querySelector(".card");
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("type", "placed");
      e.dataTransfer.setData("workerId", card.dataset.workerId);
      e.dataTransfer.setData("assignmentId", card.dataset.assignmentId);
      e.dataTransfer.setData("fromAreaId", card.dataset.areaId);
    });
    dropEl.appendChild(slot);
  }

  // ドロップターゲット（エリア）
  mount.querySelectorAll(".drop").forEach((drop) => {
    drop.addEventListener("dragover", (e) => e.preventDefault());
    drop.addEventListener("drop", async (e) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("type");
      const areaId = drop.dataset.areaId;
      if (type === "pool") {
        // 未配置 → IN
        const workerId = e.dataTransfer.getData("workerId");
        try {
          await createAssignment({
            siteId: site.siteId,
            floorId: site.floorId,
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
          await closeAssignment(assignmentId);
          await createAssignment({
            siteId: site.siteId,
            floorId: site.floorId,
            areaId,
            workerId
          });
        } catch (err) {
          console.warn("move (close+create) failed", err);
        }
      }
    });
  });

  // 外部（Dashboard）から呼ばれる：在籍スナップショットの反映
  function updateFromAssignments(rows) {
    // クリアしてから再構築（シンプルな再描画）
    mount.querySelectorAll(".drop").forEach((d) => (d.innerHTML = ""));
    rows.forEach((r) => {
      const drop = mount.querySelector(`.drop[data-area-id="${r.areaId}"]`);
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
      if (hint) hint.textContent = `配置：エリア${areaId}（クリックでOUT）`;
    });
  }

  // グローバルフック（既存実装がこれを呼ぶ）
  window.__floorRender = { updateFromAssignments, setWorkerMap };

  // アンマウント
  return () => {
    if (window.__floorRender) delete window.__floorRender;
    mount.innerHTML = "";
  };
}
