// modules/panel-pool.js
import { fmtRange } from "../core/ui.js";
import { getContrastTextColor } from "../core/colors.js";
import { DEFAULT_SKILL_SETTINGS } from "../api/firebase.js";
import { createSkillColumns, normalizeSkillLevels } from "./skill-layout.js";

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
  const {
    readOnly = false,
    onEditWorker,
    skillSettings = DEFAULT_SKILL_SETTINGS
  } = options;
  container.innerHTML = "";
  workers.forEach((w) =>
    container.appendChild(card(w, readOnly, onEditWorker, skillSettings))
  );
}

function applyAccent(el, color) {
  if (!el) return;
  if (color) {
    el.style.setProperty("--card-accent", color);
    el.style.setProperty("--card-accent-text", getContrastTextColor(color));
  } else {
    el.style.removeProperty("--card-accent");
    el.style.removeProperty("--card-accent-text");
  }
}

function buildCardBody(worker, readOnly) {
  const body = document.createElement("div");
  body.className = "card-body";

  const header = document.createElement("div");
  header.className = "card-header";

  if (worker.isLeader) {
    const leader = document.createElement("span");
    leader.className = "leader-mark";
    leader.title = "リーダー";
    leader.textContent = "★";
    header.appendChild(leader);
  }

  const name = document.createElement("div");
  name.className = "card-name";
  name.textContent = worker.name || worker.workerId || "?";
  header.appendChild(name);

  const employment = document.createElement("div");
  employment.className = "employment-count";
  employment.innerHTML = `<span class="count">${Number(
    worker.employmentCount || 0
  )}</span><span class="unit">回</span>`;
  header.appendChild(employment);

  const time = document.createElement("div");
  time.className = "card-time";
  const meta = fmtRange(worker.defaultStartTime, worker.defaultEndTime);
  time.textContent = meta || "時間未設定";

  const memo = document.createElement("div");
  memo.className = "card-memo hint";
  memo.textContent = worker.memo ? `備考: ${worker.memo}` : "備考: -";

  const hint = document.createElement("div");
  hint.className = "hint";
  hint.textContent = readOnly ? "閲覧モード" : "ドラッグで配置（IN）";

  body.appendChild(header);
  body.appendChild(time);
  body.appendChild(memo);
  body.appendChild(hint);

  return body;
}

function card(worker, readOnly, onEditWorker, skillSettings) {
  const el = document.createElement("div");
  el.className = "card";
  const panelColor = worker.panel?.color || worker.panelColor || "";
  applyAccent(el, panelColor);

  if (!readOnly) {
    el.setAttribute("draggable", "true");
    el.dataset.type = "pool";
    el.dataset.workerId = worker.workerId;
  } else {
    el.classList.add("readonly");
  }

  const { left, right } = createSkillColumns(
    skillSettings,
    normalizeSkillLevels(worker.skillLevels)
  );
  const body = buildCardBody(worker, readOnly);

  const settingsBtn = document.createElement("button");
  settingsBtn.type = "button";
  settingsBtn.className = "card-action";
  settingsBtn.textContent = "⚙";
  settingsBtn.title = "作業員情報を編集";
  settingsBtn.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof onEditWorker === "function") {
      onEditWorker(worker.workerId);
    }
  });

  el.appendChild(left);
  el.appendChild(body);
  el.appendChild(right);
  el.appendChild(settingsBtn);

  if (!readOnly) {
    el.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("type", "pool");
      e.dataTransfer.setData("workerId", worker.workerId);
    });
  }

  return el;
}
