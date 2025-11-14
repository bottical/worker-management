const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function normalizeHex(input) {
  if (!input) return null;
  const hex = input.trim();
  if (!HEX_COLOR_PATTERN.test(hex)) return null;
  let value = hex.slice(1);
  if (value.length === 3) {
    value = value
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return value.toLowerCase();
}

export function useLightText(color) {
  const normalized = normalizeHex(color);
  if (!normalized) return false;
  const [r, g, b] = [
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255
  ];
  const toLinear = (channel) =>
    channel <= 0.03928
      ? channel / 12.92
      : Math.pow((channel + 0.055) / 1.055, 2.4);
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance < 0.5;
}

export function getContrastTextColor(color, light = "#fff", dark = "#0f172a") {
  return useLightText(color) ? light : dark;
}
