// api/sheets.js
import { ENV } from "../config/env.js";
import { state } from "../core/store.js";

/**
 * Googleスプレッドシート（Sheets API v4）から
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

const SHEETS_API_BASE = "https://sheets.googleapis.com/v4/spreadsheets";

function getSheetsApiKey() {
  const configuredKey = (state?.sheetsApiKey || "").trim();
  if (configuredKey) {
    return configuredKey;
  }
  return ENV?.sheetsApiKey || ENV?.firebase?.apiKey || "";
}

function buildRange(sheetTitle, startCell, endCell) {
  const escaped = `'${String(sheetTitle).replace(/'/g, "''")}'`;
  if (!endCell || endCell === startCell) {
    return `${escaped}!${startCell}`;
  }
  return `${escaped}!${startCell}:${endCell}`;
}

function buildSheetsApiUrl(path, query = {}) {
  const apiKey = getSheetsApiKey();
  if (!apiKey) {
    const err = new Error("Google Sheets API key is not configured");
    err.code = "SHEETS_API_KEY_MISSING";
    throw err;
  }

  const url = new URL(`${SHEETS_API_BASE}/${path}`);
  Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((v) => url.searchParams.append(key, v));
      } else {
        url.searchParams.append(key, value);
      }
    });
  url.searchParams.set("key", apiKey);
  return url.toString();
}

async function fetchSheetsApi(url, { feature }) {
  console.debug(`[Sheets] ${feature} fetch`, { url });
  const res = await fetch(url);
  const text = await res.text();
  let data;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn(`[Sheets] ${feature} JSON parse failed`, e);
    }
  }

  if (!res.ok) {
    const message =
      data?.error?.message || `Failed to fetch ${feature}: ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.details = data?.error;
    if (
      res.status === 404 ||
      data?.error?.status === "NOT_FOUND" ||
      /unable to parse range/i.test(message) ||
      /requested entity was not found/i.test(message)
    ) {
      err.code = "SHEET_NOT_FOUND";
    } else if (res.status === 403 || res.status === 401) {
      err.code = "SHEET_ACCESS_DENIED";
    }
    console.warn(`[Sheets] ${feature} response not ok`, {
      status: res.status,
      statusText: res.statusText,
      message
    });
    throw err;
  }

  console.debug(`[Sheets] ${feature} payload`, text.slice(0, 200));
  return data;
}

async function fetchValueRange({
  sheetId,
  sheetTitle,
  startCell,
  endCell,
  feature,
  majorDimension = "ROWS"
}) {
  const range = buildRange(sheetTitle, startCell, endCell);
  const url = buildSheetsApiUrl(
    `${encodeURIComponent(sheetId)}/values:batchGet`,
    {
      ranges: range,
      majorDimension
    }
  );
  const data = await fetchSheetsApi(url, { feature });
  const valueRange = data?.valueRanges?.[0];
  return valueRange?.values || [];
}

export async function listSheets(sheetId) {
  let data;
  try {
    data = await fetchSheetsApi(
      buildSheetsApiUrl(`${encodeURIComponent(sheetId)}`, {
        fields: "sheets.properties.title"
      }),
      { feature: "listSheets" }
    );
  } catch (err) {
    if (err.code === "SHEET_ACCESS_DENIED") {
      console.info("[Sheets] listSheets not accessible", err.details || err);
      return undefined;
    }
    throw err;
  }

  const titles = (data?.sheets || [])
    .map((sheet) => sheet?.properties?.title)
    .filter((title) => typeof title === "string" && title.trim().length > 0)
    .map((title) => title.trim());

  return Array.from(new Set(titles));
}

export async function ensureSheetExists({ sheetId, dateStr }) {
  let availableSheets;
  let listSheetsError;
  try {
    availableSheets = await listSheets(sheetId);
  } catch (err) {
    listSheetsError = err;
    if (err.code !== "SHEET_NOT_FOUND") {
      console.warn("[Sheets] ensureSheetExists listSheets failed", err);
    }
  }

  if (Array.isArray(availableSheets)) {
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

  try {
    await fetchValueRange({
      sheetId,
      sheetTitle: dateStr,
      startCell: "A1",
      endCell: "A1",
      feature: "ensureSheetExists"
    });
  } catch (err) {
    if (err.code === "SHEET_NOT_FOUND" && Array.isArray(availableSheets)) {
      err.availableSheets = availableSheets;
    } else if (
      err.code === "SHEET_NOT_FOUND" &&
      Array.isArray(listSheetsError?.availableSheets)
    ) {
      err.availableSheets = listSheetsError.availableSheets;
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

  // Sheets APIから200が返ればシートは存在すると判断
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
  const idColumn = (idCol || "A").toUpperCase();
  const nameCol = nextCol(idColumn);
  const areaCol = nextCol(nameCol);

  let values;
  try {
    values = await fetchValueRange({
      sheetId,
      sheetTitle: dateStr,
      startCell: `${idColumn}${startRow}`,
      endCell: `${areaCol}9999`,
      feature: "readWorkerRows"
    });
  } catch (err) {
    if (err.code === "SHEET_NOT_FOUND") {
      throw err;
    }
    console.warn("[Sheets] readWorkerRows unexpected failure", err);
    throw err;
  }

  console.debug("[Sheets] readWorkerRows received", {
    rows: values.length,
    startRow,
    idColumn,
    nameCol,
    areaCol
  });

  const rowsOut = [];
  for (const row of values) {
    if (!Array.isArray(row)) continue;
    const [workerIdRaw = "", nameRaw = "", areaRaw = ""] = row;
    const workerId = String(workerIdRaw || "").trim();
    const name = String(nameRaw || "").trim();
    const areaId = String(areaRaw || "").trim();
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
    fetchedRows: values.length,
    outputRows: rowsOut.length,
    uniqueCount: unique.length,
    duplicates: dup.size
  });

  return {
    ids: unique.map((p) => p.workerId),
    rows: unique,
    duplicates: Array.from(dup)
  };
}
