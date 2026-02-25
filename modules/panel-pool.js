// modules/panel-pool.js
import { fmtRange } from "../core/ui.js";
import { getContrastTextColor } from "../core/colors.js";
import { DEFAULT_SKILL_SETTINGS } from "../api/firebase.js";
import {
  createSkillColumns,
  normalizeSkillEmploymentCounts,
  normalizeSkillLevels
} from "./skill-layout.js";

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
    skillSettings = DEFAULT_SKILL_SETTINGS,
    currentDate = ""
  } = options;
  container.innerHTML = "";
  workers.forEach((w) =>
    container.appendChild(
      card(w, readOnly, onEditWorker, skillSettings, currentDate)
    )
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

function normalizeDateValue(value) {
  if (!value) return "";
  return String(value).trim();
}

function formatShortDate(value) {
  const normalized = normalizeDateValue(value);
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return normalized;
  const [, year, month, day] = match;
  return `${year.slice(-2)}/${month}/${day}`;
}

function resolveLastWorkDate(worker, currentDate) {
  const lastWorkDate = normalizeDateValue(worker.lastWorkDate);
  if (!lastWorkDate) return "";
  const current = normalizeDateValue(currentDate);
  if (current && lastWorkDate >= current) {
    return normalizeDateValue(worker.previousWorkDate);
  }
  return lastWorkDate;
}

function buildCardBody(worker, currentDate) {
  const body = document.createElement("div");
  body.className = "card-body";

  const header = document.createElement("div");
  header.className = "card-header";

  const name = document.createElement("div");
  name.className = "card-name card-chip";
  name.textContent = worker.name || worker.workerId || "?";
  header.appendChild(name);

  const time = document.createElement("div");
  time.className = "card-time";
  const meta = fmtRange(worker.defaultStartTime, worker.defaultEndTime);
  time.textContent = meta || "時間未設定";

  const memo = document.createElement("div");
  memo.className = "card-memo hint";
  const normalizedMemo = typeof worker.memo === "string" ? worker.memo.trim() : "";
  memo.textContent = normalizedMemo ? `備考: ${normalizedMemo}` : "備考: -";

  const lastWork = document.createElement("div");
  lastWork.className = "employment-count";
  const lastWorkDate = resolveLastWorkDate(worker, currentDate);
  const formattedDate = formatShortDate(lastWorkDate);
  lastWork.innerHTML = `<span class="label">最終作業日</span><span class="count">${
    formattedDate || "-"
  }</span>`;

  const metaRow = document.createElement("div");
  metaRow.className = "card-meta-row";
  metaRow.appendChild(memo);
  metaRow.appendChild(lastWork);

  const compactTooltip = [
    normalizedMemo ? `備考: ${normalizedMemo}` : "",
    formattedDate ? `最終作業日: ${formattedDate}` : "最終作業日: -"
  ]
    .filter(Boolean)
    .join("\n");
  if (compactTooltip) {
    body.dataset.compactTooltip = compactTooltip;
    body.title = compactTooltip;
  }

  body.appendChild(header);
  body.appendChild(time);
  body.appendChild(metaRow);

  return body;
}

function card(worker, readOnly, onEditWorker, skillSettings, currentDate) {
  const el = document.createElement("div");
  el.className = "card pool-card";
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
    normalizeSkillLevels(worker.skillLevels),
    normalizeSkillEmploymentCounts(worker.skillEmploymentCounts)
  );
  const body = buildCardBody(worker, currentDate);
  if (body.dataset.compactTooltip) {
    el.dataset.compactTooltip = body.dataset.compactTooltip;
    el.title = body.dataset.compactTooltip;
  }

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
