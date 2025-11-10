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

const GVIZ_RESPONSE_PATTERN = /setResponse\((.*)\);?$/s;

async function fetchGvizPayload(url, { feature }) {
  console.debug(`[Sheets] ${feature} fetch`, { url });
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Failed to fetch ${feature}: ${res.status}`);
    if (res.status === 404) err.code = "SHEET_NOT_FOUND";
    err.status = res.status;
    console.warn(`[Sheets] ${feature} response not ok`, {
      status: res.status,
      statusText: res.statusText
    });
    throw err;
  }

  const text = (await res.text()).trim();
  console.debug(`[Sheets] ${feature} payload`, text.slice(0, 160));
  const match = text.match(GVIZ_RESPONSE_PATTERN);
  if (!match) {
    const err = new Error("Specified sheet not found");
    err.code = "SHEET_NOT_FOUND";
    console.warn(`[Sheets] ${feature} missing setResponse marker`);
    throw err;
  }

  try {
    return JSON.parse(match[1]);
  } catch (e) {
    const err = new Error("Specified sheet not found");
    err.code = "SHEET_NOT_FOUND";
    console.warn(`[Sheets] ${feature} JSON parse failed`, e);
    throw err;
  }
}

async function listSheetsFromWorksheetFeed(sheetId) {
  const url = `https://spreadsheets.google.com/feeds/worksheets/${encodeURIComponent(
    sheetId
  )}/public/full?alt=json`;
  console.debug("[Sheets] listSheets fallback fetch", { url });
  const res = await fetch(url);
  if (!res.ok) {
    const err = new Error(`Failed to fetch listSheets: ${res.status}`);
    if (res.status === 404) err.code = "SHEET_NOT_FOUND";
    err.status = res.status;
    console.warn("[Sheets] listSheets fallback response not ok", {
      status: res.status,
      statusText: res.statusText
    });
    throw err;
  }

  try {
    const data = await res.json();
    const entries = data?.feed?.entry || [];
    const titles = entries
      .map((entry) => entry?.title?.$t)
      .filter((title) => typeof title === "string" && title.trim().length > 0)
      .map((title) => title.trim());
    return Array.from(new Set(titles));
  } catch (e) {
    console.warn("[Sheets] listSheets fallback JSON parse failed", e);
    const err = new Error("Failed to parse worksheet feed");
    err.code = "SHEET_NOT_FOUND";
    throw err;
  }
}

export async function listSheets(sheetId) {
  const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
    sheetId
  )}/gviz/sheetmetadata?tqx=out:json`;
  let payload;
  try {
    payload = await fetchGvizPayload(url, { feature: "listSheets" });
  } catch (err) {
    if (err.code === "SHEET_NOT_FOUND") {
      console.info("[Sheets] listSheets falling back to worksheet feed");
      const fallbackSheets = await listSheetsFromWorksheetFeed(sheetId);
      if (fallbackSheets.length > 0) {
        return fallbackSheets;
      }
    }
    throw err;
  }

  if (payload.status !== "ok") {
    const err = new Error(
      payload.errors?.[0]?.message || "Failed to read sheet metadata"
    );
    err.code = "SHEET_NOT_FOUND";
    throw err;
  }

  const rows = payload.table?.rows || [];
  const cols = payload.table?.cols || [];
  const titleIndex = cols.findIndex((col) =>
    typeof col.label === "string" && /title|name/i.test(col.label)
  );

  const titles = [];
  for (const row of rows) {
    const cells = row.c || [];
    const cell =
      titleIndex >= 0
        ? cells[titleIndex]
        : cells.find((c) => typeof c?.v === "string" && c.v.trim().length > 0);
    const value = cell?.v || cell?.f;
    if (typeof value === "string" && value.trim().length > 0) {
      titles.push(value.trim());
    }
  }

  return Array.from(new Set(titles));
}

export async function ensureSheetExists({ sheetId, dateStr }) {
  let availableSheets;
  try {
    availableSheets = await listSheets(sheetId);
  } catch (err) {
    if (err.code === "SHEET_NOT_FOUND") {
      throw err;
    }
    console.warn("[Sheets] ensureSheetExists listSheets failed", err);
  }

  if (Array.isArray(availableSheets) && availableSheets.length > 0) {
    const exists = availableSheets.some(
      (title) => typeof title === "string" && title.trim() === dateStr
    );
    if (exists) return;
    // 一覧は取れたが目的タブがない → この時だけエラー
    const err = new Error("Specified sheet not found");
    err.code = "SHEET_NOT_FOUND";
    err.availableSheets = availableSheets;
    throw err;
  }

  const metaUrl = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
    sheetId
  )}/gviz/tq?sheet=${encodeURIComponent(
    dateStr
  )}&headers=1&range=A1:A1&tqx=out:json`;

  let payload;
  try {
    payload = await fetchGvizPayload(metaUrl, { feature: "ensureSheetExists" });
  } catch (err) {
    if (err.code === "SHEET_NOT_FOUND" && Array.isArray(availableSheets)) {
      err.availableSheets = availableSheets;
    } else if (err.code === "SHEET_NOT_FOUND") {
      try {
        const sheets = await listSheets(sheetId);
        if (Array.isArray(sheets) && sheets.length > 0) {
          err.availableSheets = sheets;
        }
      } catch (listErr) {
        console.warn(
          "[Sheets] ensureSheetExists failed to list sheets after fetch",
          listErr
        );
      }
    }
    throw err;
  }

  if (payload.status !== "ok") {
    const err = new Error(
      payload.errors?.[0]?.message || "Specified sheet not found"
    );
    err.code = "SHEET_NOT_FOUND";
    if (Array.isArray(availableSheets)) {
      err.availableSheets = availableSheets;
    } else {
      try {
        const sheets = await listSheets(sheetId);
        if (Array.isArray(sheets) && sheets.length > 0) {
          err.availableSheets = sheets;
        }
      } catch (listErr) {
        console.warn("[Sheets] ensureSheetExists failed to list sheets", listErr);
      }
    }
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
