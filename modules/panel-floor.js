import { createAssignment, endAssignment, updateAssignmentArea } from "../api/firebase.js";
import { toast } from "../core/ui.js";

/**
 * 右側のエリアパネルを生成
 * @param mount DOM
 * @param site { siteId, floorId }
 * @param workerMap Map<workerId, {name, defaultStartTime?, defaultEndTime?}>
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

  // 画面上の配置状況
  const placed = new Map();

  // ドラッグ受け入れ
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

      // プール→配置（新規IN）
      if (data.type === "pool") {
        const workerId = data.workerId;
        if (placed.has(workerId)) {
          const info = getWorkerInfo(workerId);
          toast(`重複配置は不可（${info.name} は ${placed.get(workerId).zone} 済）`, "error");
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

      // 配置済み→別エリアへ移動
      if (data.type === "placed") {
        const { workerId, assignmentId, fromAreaId } = data;
        if (fromAreaId === areaId) return; // 同じエリアなら何もしない
        try{
          await updateAssignmentArea({ assignmentId, areaId });
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

  function fmtRange(s, e){
    const norm = (t)=> (t||"").toString().trim();
    const toLabel=(t)=>{
      if(!t) return "";
      const m = String(t).match(/^(\d{1,2})(?::?(\d{2}))?$/);
      if(!m) return t;
      const hh = String(parseInt(m[1],10));
      const mm = (m[2]||"00");
      return (mm==="00") ? hh : `${hh}:${mm}`;
    };
    const a = toLabel(norm(s)), b = toLabel(norm(e));
    if(!a && !b) return "";
    if(a && b) return `【${a}-${b}】`;
    return `【${a||b}】`;
  }

  function getWorkerInfo(workerId){
    const w = workerMap.get(workerId) || {};
    return {
      name: w.name || workerId,
      start: w.defaultStartTime,
      end: w.defaultEndTime
    };
  }

  // スロット（配置済みカード）を追加（クリックOUT／ドラッグ移動可能）
  function addSlot(dropEl, workerId, areaId, assignmentId){
    const info = getWorkerInfo(workerId);
    const meta = fmtRange(info.start, info.end);
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.innerHTML = `
      <div class="card" draggable="true" data-type="placed"
           data-assignment-id="${assignmentId}" data-worker-id="${workerId}" data-area-id="${areaId}">
        <div class="avatar">${info.name.charAt(0)}</div>
        <div>
          <div class="mono">${info.name}${meta ? ` ${meta}` : ""}</div>
          <div class="hint">配置：エリア${areaId}（クリックでOUT）</div>
        </div>
      </div>
    `;
    const card = slot.querySelector(".card");

    // クリック＝OUT
    card.addEventListener("click", async ()=>{
      const ok = confirm(`${info.name} をOUT（退場）しますか？`);
      if(!ok) return;
      try{
        await endAssignment({ assignmentId });
        toast(`${info.name} をOUTしました`);
        // UIは購読で更新（未配置への戻しは Dashboard 側で再描画）
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
