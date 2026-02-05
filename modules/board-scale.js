const DEFAULTS = {
  min: 0.75,
  max: 1.35,
  biasKey: "boardScaleBias",
  biasMin: -0.25,
  biasMax: 0.25
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function parseSizeToken(value, fallback) {
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseFloat(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBias(key, min, max) {
  if (typeof localStorage === "undefined") return 0;
  const raw = Number(localStorage.getItem(key));
  if (!Number.isFinite(raw)) return 0;
  return clamp(raw, min, max);
}

export function setupBoardScale({ viewportEl, stageEl, options = {} }) {
  if (!viewportEl || !stageEl) {
    return () => {};
  }
  const config = { ...DEFAULTS, ...options };

  const recalc = () => {
    const rootStyles = getComputedStyle(document.documentElement);
    const baseW = parseSizeToken(rootStyles.getPropertyValue("--board-max-width"), 1920);
    const baseH = parseSizeToken(rootStyles.getPropertyValue("--board-max-height"), 1080);
    const viewRect = viewportEl.getBoundingClientRect();
    const safeW = Math.max(viewRect.width, 1);
    const safeH = Math.max(viewRect.height, 1);
    const rawScale = Math.min(safeW / baseW, safeH / baseH);
    const bias = readBias(config.biasKey, config.biasMin, config.biasMax);
    const scale = clamp(rawScale + bias, config.min, config.max);

    const scaledWidth = baseW * scale;
    const scaledHeight = baseH * scale;
    const offsetX = 0;

    viewportEl.style.setProperty("--board-scale", `${scale}`);
    viewportEl.style.setProperty("--board-offset-x", `${offsetX}px`);
    viewportEl.style.setProperty("--board-offset-y", "0px");
    stageEl.style.setProperty("--board-scale", `${scale}`);
    stageEl.style.width = `${baseW}px`;
    stageEl.style.height = `${baseH}px`;
  };

  const handleResize = () => recalc();

  window.addEventListener("resize", handleResize);
  window.visualViewport?.addEventListener("resize", handleResize);
  recalc();

  return () => {
    window.removeEventListener("resize", handleResize);
    window.visualViewport?.removeEventListener("resize", handleResize);
  };
}
