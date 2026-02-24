const JST_OFFSET_MINUTES = 9 * 60;

/**
 * JST基準の日付文字列(YYYY-MM-DD)を返す
 * @param {Date | number | string} [value]
 * @returns {string}
 */
export function getJstDateString(value = new Date()) {
  const base = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(base.getTime())) {
    throw new Error("Invalid date value");
  }
  const utcMillis = base.getTime() + base.getTimezoneOffset() * 60 * 1000;
  const jstMillis = utcMillis + JST_OFFSET_MINUTES * 60 * 1000;
  return new Date(jstMillis).toISOString().slice(0, 10);
}
