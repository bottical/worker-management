// pages/dashboard.html.js
import { state } from "../core/store.js";
import { makePool, drawPool } from "../modules/panel-pool.js";
import { makeFloor } from "../modules/panel-floor.js";
import { subscribeAssignments, subscribeWorkers } from "../api/firebase.js";

export function renderDashboard(mount) {
  const wrap = document.createElement("div");
  wrap.className = "grid twocol";
  wrap.innerHTML = `
    <aside class="panel left">
      <h2>未配置（<span id="count">0</span>名）</h2>
      <div class="hint">左から右へドラッグ＆ドロップ</div>
      <div id="pool" class="cards"></div>
    </aside>
    <section class="panel right">
      <h2>フロア図</h2>
      <div id="floor"></div>
    </section>
  `;
  mount.appendChild(wrap);

  const poolEl = wrap.querySelector("#pool");
  const floorEl = wrap.querySelector("#floor");
  const countEl = wrap.querySelector("#count");

  // 初期（インポート直後の暫定値）
  let workers = Array.isArray(state.workers)
    ? state.workers.map((w) =>
        typeof w === "string" ? { workerId: w, name: w } : w
      )
    : [];

  // プール/フロア共通で使う workerMap（色・時間も含む）
  let workerMap = new Map(
    workers.map((w) => [
      w.workerId,
      {
        name: w.name || w.workerId,
        defaultStartTime: w.defaultStartTime || "",
        defaultEndTime: w.defaultEndTime || "",
        panelColor: w.panel?.color || ""
      }
    ])
  );

  // フロア初期化
  const unmountFloor = makeFloor(floorEl, state.site, workerMap);
  makePool(poolEl, state.site);

  // 購読状態
  let latestAssignments = [];

  function reconcile() {
    // フロア（在籍）更新
    window.__floorRender?.updateFromAssignments(latestAssignments);
    window.__floorRender?.setWorkerMap(workerMap);
    // プール（未配置= workers ー assigned）
    const assigned = new Set(latestAssignments.map((r) => r.workerId));
    const notAssigned = workers.filter((w) => !assigned.has(w.workerId));
    drawPool(poolEl, notAssigned);
    countEl.textContent = String(notAssigned.length);
  }

  // 作業者マスタ購読（色・時間・active・名前）
  const unsubWorkers = subscribeWorkers((rows) => {
    const active = rows.filter((w) => w.active);
    workers = active.map((w) => ({
      workerId: w.workerId,
      name: w.name || w.workerId,
      defaultStartTime: w.defaultStartTime || "",
      defaultEndTime: w.defaultEndTime || "",
      panel: { color: w.panel?.color || "" }
    }));
    workerMap = new Map(
      workers.map((w) => [
        w.workerId,
        {
          name: w.name,
          defaultStartTime: w.defaultStartTime,
          defaultEndTime: w.defaultEndTime,
          panelColor: w.panel?.color || ""
        }
      ])
    );
    reconcile();
  });

  // 在籍購読
  const unsubAssign = subscribeAssignments(state.site, (rows) => {
    latestAssignments = rows;
    reconcile();
  });

  // アンマウント
  window.addEventListener(
    "hashchange",
    () => {
      try {
        unsubAssign();
      } catch {}
      try {
        unsubWorkers();
      } catch {}
      try {
        unmountFloor?.();
      } catch {}
    },
    { once: true }
  );
}
