// core/ui.js

// --- Toast機能 ---
const toastEl = (() => {
  const el = document.createElement("div");
  el.className = "toast";
  document.body.appendChild(el);
  return el;
})();

/**
 * トースト表示（デフォルトinfo／エラー時は赤）
 * @param {string} msg - 表示メッセージ
 * @param {"info"|"error"} type - 表示タイプ
 */
export function toast(msg, type = "info") {
  toastEl.textContent = msg;
  toastEl.style.background = type === "error" ? "#b91c1c" : "#111827";
  toastEl.classList.add("show");
  setTimeout(() => toastEl.classList.remove("show"), 2600);
}

// --- 勤怠時間表示フォーマッタ ---
/**
 * 勤怠時間を「9:00〜18:00」等の短い表記に変換
 * @param {string} start - 開始時刻（例: "09:00"）
 * @param {string} end - 終了時刻（例: "18:00"）
 * @returns {string} - フォーマット済み文字列
 */
export function fmtRange(start, end) {
  if (!start || !end) return "";
  const [startHour] = start.split(":");
  const [endHour] = end.split(":");
  return `${startHour}-${endHour}`;
}
