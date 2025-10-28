import { fetchWithRetry } from "../core/http.js";

export async function readWorkerIds({ sheetId, dateStr, col, hasHeader }){
  const startRow = hasHeader ? 2 : 1;
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(dateStr)}&range=${col}${startRow}:${col}9999`;
  const text = await fetchWithRetry(url);
  const ids = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(v=>v.replace(/^"|"$/g,"").trim());
  return Array.from(new Set(ids)).filter(Boolean);
}
