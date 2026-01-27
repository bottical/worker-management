// modules/skill-layout.js
import { DEFAULT_SKILL_SETTINGS } from "../api/firebase.js";

const SKILL_COLORS = ["#60a5fa", "#facc15", "#22c55e", "#f472b6", "#a855f7", "#f97316"];

export function normalizeSkillLevels(levels = {}) {
  if (!levels || typeof levels !== "object") return {};
  const result = {};
  Object.entries(levels).forEach(([key, value]) => {
    if (typeof value === "string" && value.trim()) {
      result[key] = value.trim();
    }
  });
  return result;
}

export function normalizeSkillEmploymentCounts(counts = {}) {
  if (!counts || typeof counts !== "object") return {};
  const result = {};
  Object.entries(counts).forEach(([key, value]) => {
    const num = Number(value);
    if (Number.isFinite(num)) {
      result[key] = num;
    }
  });
  return result;
}

function getLevelOrder(skillSettings = DEFAULT_SKILL_SETTINGS) {
  const order = new Map();
  (skillSettings?.levels || DEFAULT_SKILL_SETTINGS.levels).forEach((level, idx) => {
    if (!level?.id) return;
    order.set(level.id, idx);
  });
  return order;
}

function getNormalizedSkills(skillSettings = DEFAULT_SKILL_SETTINGS) {
  const skills = Array.isArray(skillSettings?.skills)
    ? skillSettings.skills
    : DEFAULT_SKILL_SETTINGS.skills;
  if (!skills.length) return DEFAULT_SKILL_SETTINGS.skills;
  return skills.map((skill, idx) => ({
    id: skill?.id || `skill${idx + 1}`,
    name: skill?.name || `スキル${idx + 1}`
  }));
}

function createSkillIndicator(skill, levelId, levelOrder, idx) {
  const indicator = document.createElement("div");
  indicator.className = "skill-indicator";
  indicator.dataset.skillId = skill.id;
  indicator.title = skill.name;
  indicator.style.setProperty("--skill-color", SKILL_COLORS[idx % SKILL_COLORS.length]);

  const rank = levelOrder.get(levelId);
  if (rank === 1) {
    indicator.dataset.level = "mid";
  } else if (typeof rank === "number" && rank >= 2) {
    indicator.dataset.level = "high";
  } else {
    indicator.dataset.level = "none";
  }

  return indicator;
}

function createSkillCount(value) {
  const countEl = document.createElement("div");
  countEl.className = "skill-count";
  const normalized = Number.isFinite(Number(value)) ? Number(value) : 0;
  countEl.textContent = String(normalized);
  return countEl;
}

function createSkillColumn() {
  const column = document.createElement("div");
  column.className = "skill-column";
  return column;
}

export function createSkillColumns(
  skillSettings = DEFAULT_SKILL_SETTINGS,
  skillLevels = {},
  skillCounts = {}
) {
  const skills = getNormalizedSkills(skillSettings);
  const levelOrder = getLevelOrder(skillSettings);
  const columns = Array.from({ length: 4 }, () => createSkillColumn());

  skills.forEach((skill, idx) => {
    const levelId = skillLevels?.[skill.id] || "";
    const countValue = skillCounts?.[skill.id] ?? 0;
    const column = columns[idx % columns.length];
    column.appendChild(createSkillIndicator(skill, levelId, levelOrder, idx));
    column.appendChild(createSkillCount(countValue));
  });

  const left = document.createElement("div");
  left.className = "skill-column-group left";
  left.append(columns[0], columns[1]);

  const right = document.createElement("div");
  right.className = "skill-column-group right";
  right.append(columns[2], columns[3]);

  return { left, right };
}
