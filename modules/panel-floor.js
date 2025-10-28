import { createAssignment } from "../api/firebase.js";
import { toast } from "../core/ui.js";

/**
 * 右側のエリアパネルを生成
 * @param mount DOM
 * @param site { siteId, floorId }
 * @returns unmount()
 */
export function makeFloor(mount, site){
  mount.innerHTML = `
    <div class="zones">
      <section class="zone" data-zone="A">
        <h3>エリア A</h3>
        <div class="droparea" data-drop="A"></div>
      </section>
      <section class="zone" data-zone="B">
        <h3>エリア B</h3>
        <div class="droparea" data-drop="B"></div>
      </section>
    </div>
  `;

  const placed = new Map(); // workerId -> { zone, assignmentId }

  // ドラッグ受け入れ
  mount.querySelectorAll(".zone").forEach(zone => {
    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", async e => {
      e.preventDefault(); zone.classList.remove("dragover");
      const workerId = e.dataTransfer.getData("text/plain");
      if (!workerId) return;

      if (placed.has(workerId)) {
        toast(`重複配置は不可（${workerId} は ${placed.get(workerId).zone} 済）`, "error");
        return;
      }

      // Firestoreへ「在籍開始」を保存
      const areaId = zone.dataset.zone;
      try{
        const assignmentId = await createAssignment({
          siteId: site.siteId, floorId: site.floorId, areaId, workerId
        });
        placed.set(workerId, { zone: `エリア${areaId}`, assignmentId });
        addSlot(zone.querySelector(".droparea"), workerId, areaId);
        // プール側カードを消す
        const card = document.querySelector(`.card[data-worker-id="${CSS.escape(workerId)}"][data-in-pool="1"]`);
        card?.remove();
      }catch(e){
        console.error(e);
        toast("保存に失敗しました","error");
      }
    });
  });

  function addSlot(dropEl, workerId, areaId){
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.innerHTML = `
      <div class="card" style="cursor:default" draggable="false">
        <div class="avatar">${workerId.slice(0,1).toUpperCase()}</div>
        <div>
          <div class="mono">${workerId}</div>
          <div class="hint">配置：エリア${areaId}</div>
        </div>
      </div>
    `;
    dropEl.appendChild(slot);
  }

  // Firestore購読から呼ばれる更新フック（簡易）
  window.__floorRender = {
    updateFromAssignments(rows){
      // rows = 現在在籍中（outAt=null）の一覧。ここでは簡易に全消し→再描画
      mount.querySelectorAll(".droparea").forEach(d => d.innerHTML = "");
      placed.clear();
      for(const r of rows){
        const zone = mount.querySelector(`.zone[data-zone="${r.areaId}"] .droparea`);
        if (zone) {
          placed.set(r.workerId, { zone: `エリア${r.areaId}`, assignmentId: r.id });
          addSlot(zone, r.workerId, r.areaId);
          // プールのカードがあれば削除
          const card = document.querySelector(`.card[data-worker-id="${CSS.escape(r.workerId)}"][data-in-pool="1"]`);
          card?.remove();
        }
      }
    }
  };

  return ()=> { if (window.__floorRender) delete window.__floorRender; };
}
