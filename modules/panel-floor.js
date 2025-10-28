import { createAssignment, endAssignment } from "../api/firebase.js";
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
        <h3>エリア A（クリックでOUT）</h3>
        <div class="droparea" data-drop="A"></div>
      </section>
      <section class="zone" data-zone="B">
        <h3>エリア B（クリックでOUT）</h3>
        <div class="droparea" data-drop="B"></div>
      </section>
    </div>
  `;

  // 現在画面上に存在する workerId -> { zone, assignmentId }
  const placed = new Map();

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

      const areaId = zone.dataset.zone;
      try{
        const assignmentId = await createAssignment({
          siteId: site.siteId, floorId: site.floorId, areaId, workerId
        });
        placed.set(workerId, { zone: `エリア${areaId}`, assignmentId });
        addSlot(zone.querySelector(".droparea"), workerId, areaId, assignmentId);
        // プール側カードを消す
        const card = document.querySelector(`.card[data-worker-id="${CSS.escape(workerId)}"][data-in-pool="1"]`);
        card?.remove();
      }catch(e){
        console.error(e);
        toast("保存に失敗しました","error");
      }
    });
  });

  // スロット（配置済みカード）を追加
  function addSlot(dropEl, workerId, areaId, assignmentId){
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.innerHTML = `
      <div class="card" style="cursor:pointer" draggable="false" data-assignment-id="${assignmentId}" data-worker-id="${workerId}">
        <div class="avatar">${workerId.slice(0,1).toUpperCase()}</div>
        <div>
          <div class="mono">${workerId}</div>
          <div class="hint">配置：エリア${areaId}（クリックでOUT）</div>
        </div>
      </div>
    `;
    const card = slot.querySelector(".card");
    card.addEventListener("click", async ()=>{
      const ok = confirm(`${workerId} をOUT（退場）しますか？`);
      if(!ok) return;
      try{
        await endAssignment({ assignmentId });
        toast(`${workerId} をOUTしました`);
        // 購読でUIが更新されるため、ここでは何もしない
      }catch(e){
        console.error(e);
        toast("OUTに失敗しました","error");
      }
    });
    dropEl.appendChild(slot);
  }

  // Firestore購読から呼ばれる更新フック（外部公開）
  window.__floorRender = {
    updateFromAssignments(rows){
      // rows = 在籍中（outAt=null）
      mount.querySelectorAll(".droparea").forEach(d => d.innerHTML = "");
      placed.clear();
      for(const r of rows){
        const zone = mount.querySelector(`.zone[data-zone="${r.areaId}"] .droparea`);
        if (zone) {
          placed.set(r.workerId, { zone: `エリア${r.areaId}`, assignmentId: r.id });
          addSlot(zone, r.workerId, r.areaId, r.id);
          // プールのカードがあれば削除（未配置へ戻すには購読に依存）
          const card = document.querySelector(`.card[data-worker-id="${CSS.escape(r.workerId)}"][data-in-pool="1"]`);
          card?.remove();
        }
      }
    }
  };

  return ()=> { if (window.__floorRender) delete window.__floorRender; };
}
