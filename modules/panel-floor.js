import { createAssignment, endAssignment, updateAssignmentArea } from "../api/firebase.js";
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
        <h3>エリア A（クリックでOUT／ドラッグで他エリアへ移動）</h3>
        <div class="droparea" data-drop="A"></div>
      </section>
      <section class="zone" data-zone="B">
        <h3>エリア B（クリックでOUT／ドラッグで他エリアへ移動）</h3>
        <div class="droparea" data-drop="B"></div>
      </section>
    </div>
  `;

  // 現在画面上に存在する workerId -> { zone, assignmentId }
  const placed = new Map();

  // ドラッグ受け入れ（プール→配置 / 配置→別エリア）
  mount.querySelectorAll(".zone").forEach(zone => {
    zone.addEventListener("dragover", e => { e.preventDefault(); zone.classList.add("dragover"); });
    zone.addEventListener("dragleave", () => zone.classList.remove("dragover"));
    zone.addEventListener("drop", async e => {
      e.preventDefault(); zone.classList.remove("dragover");
      const payload = e.dataTransfer.getData("text/plain");
      if (!payload) return;

      let data;
      try { data = JSON.parse(payload); } catch { data = { type:"pool", workerId: payload }; }

      const areaId = zone.dataset.zone;

      // 1) プール→配置（新規IN）
      if (data.type === "pool") {
        const workerId = data.workerId;
        if (placed.has(workerId)) {
          toast(`重複配置は不可（${workerId} は ${placed.get(workerId).zone} 済）`, "error");
          return;
        }
        try{
          const assignmentId = await createAssignment({ siteId: site.siteId, floorId: site.floorId, areaId, workerId });
          placed.set(workerId, { zone: `エリア${areaId}`, assignmentId });
          addSlot(zone.querySelector(".droparea"), workerId, areaId, assignmentId);
          // プール側カードを消す
          const card = document.querySelector(`.card[data-worker-id="${CSS.escape(workerId)}"][data-in-pool="1"]`);
          card?.remove();
        }catch(e){ console.error(e); toast("保存に失敗しました","error"); }
        return;
      }

      // 2) 配置済み→別エリアへ移動
      if (data.type === "placed") {
        const { workerId, assignmentId, fromAreaId } = data;
        if (fromAreaId === areaId) return; // 同じエリアなら何もしない
        try{
          await updateAssignmentArea({ assignmentId, areaId });
          // UIは購読で再構築されるが、即時反映したいので軽く置換
          placed.set(workerId, { zone: `エリア${areaId}`, assignmentId });
          addSlot(zone.querySelector(".droparea"), workerId, areaId, assignmentId);
          // 元のスロットを削除
          const old = document.querySelector(`.slot [data-assignment-id="${assignmentId}"]`)?.closest(".slot");
          old?.remove();
        }catch(e){ console.error(e); toast("移動に失敗しました","error"); }
        return;
      }
    });
  });

  // スロット（配置済みカード）を追加（クリックOUT／ドラッグ移動可能）
  function addSlot(dropEl, workerId, areaId, assignmentId){
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.innerHTML = `
      <div class="card" draggable="true" data-type="placed"
           data-assignment-id="${assignmentId}" data-worker-id="${workerId}" data-area-id="${areaId}">
        <div class="avatar">${workerId.slice(0,1).toUpperCase()}</div>
        <div>
          <div class="mono">${workerId}</div>
          <div class="hint">配置：エリア${areaId}（クリックでOUT）</div>
        </div>
      </div>
    `;
    const card = slot.querySelector(".card");

    // クリック＝OUT
    card.addEventListener("click", async (ev)=>{
      // ドラッグ開始のクリックと誤爆しないように、小さな遅延判断でもOKだが最小実装ではそのまま
      if (ev.defaultPrevented) return;
      const ok = confirm(`${workerId} をOUT（退場）しますか？`);
      if(!ok) return;
      try{
        await endAssignment({ assignmentId });
        toast(`${workerId} をOUTしました`);
        // 購読でUI更新
      }catch(e){ console.error(e); toast("OUTに失敗しました","error"); }
    });

    // ドラッグ＝別エリアへ移動
    card.addEventListener("dragstart", e => {
      const payload = JSON.stringify({ type:"placed", workerId, assignmentId, fromAreaId: areaId });
      e.dataTransfer.setData("text/plain", payload);
      e.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", ()=> card.classList.remove("dragging"));

    dropEl.appendChild(slot);
  }

  // Firestore購読から呼ばれる更新フック（外部公開）
  window.__floorRender = {
    updateFromAssignments(rows){
      mount.querySelectorAll(".droparea").forEach(d => d.innerHTML = "");
      placed.clear();
      for(const r of rows){
        const zone = mount.querySelector(`.zone[data-zone="${r.areaId}"] .droparea`);
        if (zone) {
          placed.set(r.workerId, { zone: `エリア${r.areaId}`, assignmentId: r.id });
          addSlot(zone, r.workerId, r.areaId, r.id);
          // プールのカードがあれば削除
          const card = document.querySelector(`.card[data-worker-id="${CSS.escape(r.workerId)}"][data-in-pool="1"]`);
          card?.remove();
        }
      }
    }
  };

  return ()=> { if (window.__floorRender) delete window.__floorRender; };
}
