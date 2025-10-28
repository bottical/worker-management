import { fetchWithRetry } from "../core/http.js";

/** 列記号を1つ進める（A→B, Z→AA, AZ→BA） */
function nextCol(col){
  const toNum = s => s.split("").reduce((n,c)=> n*26 + (c.charCodeAt(0)-64), 0);
  const toCol = n => {
    let s=""; while(n>0){ const r=(n-1)%26; s=String.fromCharCode(65+r)+s; n=Math.floor((n-1)/26); }
    return s;
  };
  return toCol(toNum(col) + 1);
}

/**
 * ID列と、その右隣の列（名前）を読み込む
 * @returns { ids: string[], pairs: {workerId,name}[], duplicates: string[] }
 */
export async function readWorkerIdNamePairs({ sheetId, dateStr, idCol, hasHeader }){
  const startRow = hasHeader ? 2 : 1;
  const nameCol = nextCol(idCol.toUpperCase());
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetId)}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(dateStr)}&range=${idCol}${startRow}:${nameCol}9999`;

  const text = await fetchWithRetry(url);

  const lines = text.split(/\r?\n/).filter(l => l.trim().length>0);
  const pairs = [];
  for (const line of lines) {
    // 超簡易CSVパース（ダブルクオート除去＋カンマ分割）
    const cols = line.split(",").map(v => v.replace(/^"|"$/g,"").trim());
    const workerId = (cols[0] || "").trim();
    const name = (cols[1] || "").trim();
    if (!workerId) continue;
    pairs.push({ workerId, name });
  }

  // 重複ID検出
  const seen = new Set();
  const dup = new Set();
  const uniquePairs = [];
  for (const p of pairs) {
    if (seen.has(p.workerId)) { dup.add(p.workerId); continue; }
    seen.add(p.workerId);
    uniquePairs.push(p);
  }

  return {
    ids: uniquePairs.map(p => p.workerId),
    pairs: uniquePairs,
    duplicates: Array.from(dup)
  };
}
