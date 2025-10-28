import { createAssignment, endAssignment, updateAssignmentArea } from "../api/firebase.js";
import { toast } from "../core/ui.js";

/**
 * 右側のエリアパネルを生成
 * @param mount DOM
 * @param site { siteId, floorId }
 * @param workerMap Map<workerId, name> ← 追加
 * @returns unmount()
 */
export function makeFloor(mount, site, workerMap = new Map()){
  mount.innerHTML = `
    <div class="zones">
      <section class="zone" data-zone="A">
        <h3>エリア A（クリックでOUT／ドラッグで他エリアへ移動）</h3>
        <div class="droparea" data-drop="A"></div>
      </section>
      <section class="zone" data-zone="B">
        <h3>エリア B（クリックでOUT／ドラッグで他エリアへ移動）</h3>
        <div class="droparea" data-drop="B"></div>
      </section>
    </div>
  `;

  const placed = new Map();

  mount.querySelectorAll(".zone").forEach(zone => {
    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", async e => {
      e.preventDefault(); zone.classList.remove("dragover");
      const payload = e.dataTransfer.getData("text/plain");
      if (!payload) return;
      let data;
      try { data = JSON.parse(payload); } catch { return; }

      const areaId = zone.dataset.zone;

      // 新規IN
      if (data.type === "pool") {
        const workerId = data.workerId;
        const name = data.name || workerMap.get(workerId) || workerId;
        if (placed.has(workerId)) {
          toast(`重複配置は不可（${name} は ${placed.get(workerId).zone} 済）`, "error");
          return;
        }
        try {
          const assignmentId = await createAssignment({ siteId: site.siteId, floorId: site.floorId, areaId, workerId });
          placed.set(workerId, { zone: `エリア${areaId}`, assignmentId });
          addSlot(zone.querySelector(".droparea"), workerId, name, areaId, assignmentId);
          document.querySelector(`.card[data-worker-id="${CSS.escape(workerId)}"][data-in-pool="1"]`)?.remove();
        } catch (e) {
          console.error(e); toast("保存に失敗しました","error");
        }
        return;
      }

      // 配置済み→別エリア
      if (data.type === "placed") {
        const { workerId, assignmentId, fromAreaId } = data;
        if (fromAreaId === areaId) return;
        try {
          await updateAssignmentArea({ assignmentId, areaId });
          const name = workerMap.get(workerId) || workerId;
          placed.set(workerId, { zone: `エリア${areaId}`, assignmentId });
          addSlot(zone.querySelector(".droparea"), workerId, name, areaId, assignmentId);
          document.querySelector(`.slot [data-assignment-id="${assignmentId}"]`)?.closest(".slot")?.remove();
        } catch (e) {
          console.error(e); toast("移動に失敗しました","error");
        }
      }
    });
  });

  // スロット追加
  function addSlot(dropEl, workerId, name, areaId, assignmentId){
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.innerHTML = `
      <div class="card" draggable="true" data-type="placed"
           data-assignment-id="${assignmentId}" data-worker-id="${workerId}" data-area-id="${areaId}">
        <div class="avatar">${name.charAt(0)}</div>
        <div>
          <div class="mono">${name}</div>
          <div class="hint">配置：エリア${areaId}（クリックでOUT）</div>
        </div>
      </div>
    `;
    const card = slot.querySelector(".card");

    card.addEventListener("click", async ()=>{
      const ok = confirm(`${name} をOUTしますか？`);
      if(!ok) return;
      try {
        await endAssignment({ assignmentId });
        toast(`${name} をOUTしました`);
      } catch(e){ console.error(e); toast("OUTに失敗しました","error"); }
    });

    card.addEventListener("dragstart", e => {
      const payload = JSON.stringify({ type:"placed", workerId, assignmentId, fromAreaId: areaId });
      e.dataTransfer.setData("text/plain", payload);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", ()=> card.classList.remove("dragging"));

    dropEl.appendChild(slot);
  }

  window.__floorRender = {
    updateFromAssignments(rows){
      mount.querySelectorAll(".droparea").forEach(d => d.innerHTML = "");
      placed.clear();
      for(const r of rows){
        const name = workerMap.get(r.workerId) || r.workerId;
        const zone = mount.querySelector(`.zone[data-zone="${r.areaId}"] .droparea`);
        if (zone) {
          placed.set(r.workerId, { zone: `エリア${r.areaId}`, assignmentId: r.id });
          addSlot(zone, r.workerId, name, r.areaId, r.id);
          document.querySelector(`.card[data-worker-id="${CSS.escape(r.workerId)}"][data-in-pool="1"]`)?.remove();
        }
      }
    }
  };

  return ()=> { if (window.__floorRender) delete window.__floorRender; };
}
