// modules/panel-pool.js
import { fmtRange } from "../modules/ui.js";

export function makePool(mount, site) {
  // noop（現状siteは未使用だが将来用）
  return () => {};
}

/**
 * 未配置（プール）の描画
 * @param {HTMLElement} container
 * @param {Array} workers - [{workerId,name,defaultStartTime,defaultEndTime,panel:{color}}]
 */
export function drawPool(container, workers = []) {
  container.innerHTML = "";
  workers.forEach((w) => container.appendChild(card(w)));
}

function card(worker) {
  const el = document.createElement("div");
  el.className = "card";
  el.setAttribute("draggable", "true");
  el.dataset.type = "pool";
  el.dataset.workerId = worker.workerId;

  const av = document.createElement("div");
  av.className = "avatar";
  av.textContent = (worker.name || worker.workerId || "?").charAt(0);
  if (worker.panel?.color) av.style.background = worker.panel.color;

  const title = document.createElement("div");
  title.className = "mono";
  const meta = fmtRange(worker.defaultStartTime, worker.defaultEndTime);
  title.textContent = `${worker.name || worker.workerId}${meta ? ` ${meta}` : ""}`;

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = "ドラッグで配置（IN）";

  const right = document.createElement("div");
  right.appendChild(title);
  right.appendChild(hint);

  el.appendChild(av);
  el.appendChild(right);

  // DnD
  el.addEventListener("dragstart", (e) => {
    e.dataTransfer.setData("type", "pool");
    e.dataTransfer.setData("workerId", worker.workerId);
  });

  return el;
}
