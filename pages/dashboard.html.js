import { state } from "../core/store.js";
import { makePool } from "../modules/panel-pool.js";
import { makeFloor } from "../modules/panel-floor.js";
import { subscribeAssignments } from "../api/firebase.js";

export function renderDashboard(mount){
  const wrap = document.createElement("div");
  wrap.className = "grid twocol";
  wrap.innerHTML = `
    <aside class="panel left">
      <h2>未配置（<span id="count">${state.workers.length}</span>名）</h2>
      <div class="hint">左から右へドラッグ＆ドロップ</div>
      <div id="pool" class="cards"></div>
    </aside>
    <section class="panel right">
      <h2>フロア図</h2>
      <div id="floor"></div>
    </section>
  `;
  mount.appendChild(wrap);

  // workers = [{ workerId, name }]
  const workers = Array.isArray(state.workers)
    ? state.workers.map(w => typeof w === "string" ? ({ workerId: w, name: w }) : w)
    : [];

  // 左：未配置
  const poolEl = wrap.querySelector("#pool");
  const countEl = wrap.querySelector("#count");
  makePool(poolEl, workers, () => {
    countEl.textContent = document.querySelectorAll(".card[data-in-pool='1']").length;
  });

  // 右：エリア（名前解決用の Map を渡す）
  const workerMap = new Map(workers.map(w => [w.workerId, w.name || w.workerId]));
  const floorEl = wrap.querySelector("#floor");
  const unmount = makeFloor(floorEl, state.site, workerMap);

  // Firestore購読（在籍中のみを描画側に通知）
  const unsub = subscribeAssignments(state.site, (rows) => {
    // rows: [{id, siteId, floorId, areaId, workerId, inAt, ...}]
    window.__floorRender?.updateFromAssignments(rows);
  });

  // ページ離脱時クリーンアップ
  window.addEventListener("hashchange", ()=>{ try{unsub();}catch{} try{unmount?.();}catch{} }, { once:true });
}
