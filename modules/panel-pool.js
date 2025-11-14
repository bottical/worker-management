// modules/panel-pool.js
import { fmtRange } from "../core/ui.js";
import { getContrastTextColor } from "../core/colors.js";

export function makePool(mount, site) {
  // noop（現状siteは未使用だが将来用）
  return () => {};
}

/**
 * 未配置（プール）の描画
 * @param {HTMLElement} container
 * @param {Array} workers - [{workerId,name,defaultStartTime,defaultEndTime,panel:{color}}]
 */
export function drawPool(container, workers = [], options = {}) {
  const { readOnly = false } = options;
  container.innerHTML = "";
  workers.forEach((w) => container.appendChild(card(w, readOnly)));
}

function applyAvatarStyle(avatarEl, color) {
  if (!avatarEl) return;
  if (color) {
    avatarEl.style.background = color;
    avatarEl.style.color = getContrastTextColor(color);
  } else {
    avatarEl.style.background = "";
    avatarEl.style.color = "";
  }
}

function card(worker, readOnly) {
  const el = document.createElement("div");
  el.className = "card";
  if (!readOnly) {
    el.setAttribute("draggable", "true");
    el.dataset.type = "pool";
    el.dataset.workerId = worker.workerId;
  } else {
    el.classList.add("readonly");
  }

  const av = document.createElement("div");
  av.className = "avatar";
  av.textContent = (worker.name || worker.workerId || "?").charAt(0);
  const panelColor = worker.panel?.color || worker.panelColor || "";
  applyAvatarStyle(av, panelColor);

  const title = document.createElement("div");
  title.className = "mono";
  const meta = fmtRange(worker.defaultStartTime, worker.defaultEndTime);
  title.textContent = `${worker.name || worker.workerId}${meta ? ` ${meta}` : ""}`;

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = readOnly ? "閲覧モード" : "ドラッグで配置（IN）";

  const right = document.createElement("div");
  right.appendChild(title);
  right.appendChild(hint);

  el.appendChild(av);
  el.appendChild(right);

  // DnD
  if (!readOnly) {
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("type", "pool");
      e.dataTransfer.setData("workerId", worker.workerId);
    });
  }

  return el;
}
