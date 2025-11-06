// api/sheets.js
/**
 * Googleスプレッドシート（GViz CSV）から
 * 1列目: 作業者ID
 * 2列目: 氏名
 * 3列目: 基本エリアID（任意）
 * を読み込む。
 *
 * 返却: { ids: string[], rows: [{workerId,name,areaId?}] , duplicates: string[] }
 */

function nextCol(col) {
  // A, B, ... Z, AA, AB ...
  const toNum = (s) =>
    s.split("").reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0);
  const toStr = (n) => {
    let s = "";
    while (n > 0) {
      const r = (n - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  };
  return toStr(toNum(col) + 1);
}

export async function ensureSheetExists({ sheetId, dateStr }) {
  const metaUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
    sheetId
  )}/gviz/tq?sheet=${encodeURIComponent(dateStr)}&tqx=out:json`;

  console.debug("[Sheets] ensureSheetExists fetch", { metaUrl });
  const res = await fetch(metaUrl);
  if (!res.ok) {
    const err = new Error(`Failed to fetch sheet meta: ${res.status}`);
    if (res.status === 404) err.code = "SHEET_NOT_FOUND";
    console.warn("[Sheets] ensureSheetExists response not ok", {
      status: res.status,
      statusText: res.statusText
    });
    throw err;
  }

  const text = (await res.text()).trim();
  console.debug("[Sheets] ensureSheetExists payload", text.slice(0, 120));
  const match = text.match(/setResponse\((.*)\);?$/s);
  if (!match) {
    const err = new Error("Specified sheet not found");
    err.code = "SHEET_NOT_FOUND";
    console.warn("[Sheets] ensureSheetExists missing setResponse marker");
    throw err;
  }

  try {
    const payload = JSON.parse(match[1]);
    console.debug("[Sheets] ensureSheetExists parsed status", payload.status);
    if (payload.status !== "ok") {
      const err = new Error(
        payload.errors?.[0]?.message || "Specified sheet not found"
      );
      err.code = "SHEET_NOT_FOUND";
      throw err;
    }
  } catch (e) {
    const err = new Error("Specified sheet not found");
    err.code = "SHEET_NOT_FOUND";
    throw err;
  }
}

export async function readWorkerRows(
  { sheetId, dateStr, idCol, hasHeader },
  options = {}
) {
  if (!options.skipEnsure) {
    console.debug("[Sheets] readWorkerRows running ensureSheetExists");
    await ensureSheetExists({ sheetId, dateStr });
  }

  const startRow = hasHeader ? 2 : 1;
  const nameCol = nextCol(idCol.toUpperCase());
  const areaCol = nextCol(nameCol);
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
    sheetId
  )}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
    dateStr
  )}&range=${idCol}${startRow}:${areaCol}9999`;

  console.debug("[Sheets] readWorkerRows fetch", {
    url,
    startRow,
    idCol,
    nameCol,
    areaCol
  });
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Failed to fetch sheet: ${res.status}`);
    if (res.status === 404) err.code = "SHEET_NOT_FOUND";
    console.warn("[Sheets] readWorkerRows response not ok", {
      status: res.status,
      statusText: res.statusText
    });
    throw err;
  }
  const contentType = res.headers.get("content-type") || "";
  const csv = await res.text();
  console.debug("[Sheets] readWorkerRows contentType", contentType);
  console.debug("[Sheets] readWorkerRows sample", csv.slice(0, 120));

  const trimmed = csv.trim();
  if (
    /^<!doctype html/i.test(trimmed) ||
    /^<html/i.test(trimmed) ||
    /cannot find range/i.test(csv) ||
    /sheet.*not found/i.test(csv) ||
    /does not exist/i.test(csv) ||
    /unable to parse/i.test(csv) ||
    /invalid (sheet|worksheet)/i.test(csv) ||
    /^error\s*\:/i.test(trimmed) ||
    /text\/html/i.test(contentType)
  ) {
    const err = new Error("Specified sheet not found");
    err.code = "SHEET_NOT_FOUND";
    console.warn("[Sheets] readWorkerRows detected error payload");
    throw err;
  }

  const lines = csv
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const rowsOut = [];
  for (const line of lines) {
    // 超簡易CSV: ダブルクオート除去→カンマ区切り
    const cols = line.split(",").map((v) => v.replace(/^"|"$/g, "").trim());
    const workerId = (cols[0] || "").trim();
    const name = (cols[1] || "").trim();
    const areaId = (cols[2] || "").trim();
    if (!workerId) continue;
    rowsOut.push({ workerId, name, areaId });
  }

  // 重複除去
  const seen = new Set();
  const dup = new Set();
  const unique = [];
  for (const r of rowsOut) {
    if (seen.has(r.workerId)) {
      dup.add(r.workerId);
      continue;
    }
    seen.add(r.workerId);
    unique.push(r);
  }

  console.debug("[Sheets] readWorkerRows parsed", {
    totalLines: lines.length,
    uniqueCount: unique.length,
    duplicates: dup.size
  });

  return {
    ids: unique.map((p) => p.workerId),
    rows: unique,
    duplicates: Array.from(dup)
  };
}
