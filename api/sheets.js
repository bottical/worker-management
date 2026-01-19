// api/sheets.js

/**
 * Googleスプレッドシートから
 * 1列目: 作業者ID
 * 2列目: 氏名
 * 3列目: 基本エリアID（任意）
 * 4列目: 区別コード（任意）
 * を読み込む。
 *
 * 返却: { ids: string[], rows: [{workerId,name,areaId?,aliasCode?}] , duplicates: string[] }
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

function parseCellReference(cell) {
  const match = String(cell || "")
    .trim()
    .toUpperCase()
    .match(/^([A-Z]+)(\d+)$/);
  if (!match) {
    const err = new Error(`Invalid cell reference: ${cell}`);
    err.code = "INVALID_CELL_REFERENCE";
    throw err;
  }
  return { column: match[1], row: parseInt(match[2], 10) };
}

const GVIZ_BASE = "https://docs.google.com/spreadsheets/d";

function toIsoDateStringFromSerial(serial) {
  const value = Number(serial);
  if (!Number.isFinite(value)) {
    return undefined;
  }
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const base = Date.UTC(1899, 11, 30);
  const ms = Math.round(value * MS_PER_DAY);
  const date = new Date(base + ms);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDateString(value) {
  const str = String(value || "").trim();
  if (!str) {
    return "";
  }
  const iso = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const alt = str.match(/^(\d{4})[\/\.](\d{1,2})[\/\.](\d{1,2})$/);
  if (alt) {
    const [, y, m, d] = alt;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  const digits = str.replace(/\D/g, "");
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  }
  return str;
}

function normalizeReferenceCellValue(value) {
  if (value === null || value === undefined) {
    return { normalized: "", display: "" };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const iso = toIsoDateStringFromSerial(value);
    if (iso) {
      return { normalized: iso, display: iso };
    }
    const str = String(value);
    return { normalized: str, display: str };
  }
  const normalized = normalizeDateString(value);
  const display = String(value).trim();
  return { normalized, display };
}

function buildRange(startCell, endCell) {
  const start = String(startCell || "");
  const end = String(endCell || "");
  if (!end || end === start) {
    return start;
  }
  return `${start}:${end}`;
}

function detectErrorCode(message) {
  if (!message) return undefined;
  if (/not\s+found/i.test(message) || /unable to find/i.test(message)) {
    return "SHEET_NOT_FOUND";
  }
  if (/permission/i.test(message) || /access\s+denied/i.test(message)) {
    return "SHEET_ACCESS_DENIED";
  }
  return undefined;
}

async function fetchCellRange({
  sheetId,
  sheetTitle,
  startCell,
  endCell,
  feature
}) {
  const range = buildRange(startCell, endCell);
  const sheetName = String(sheetTitle || "").trim();
  const params = new URLSearchParams({ tqx: "out:json" });
  if (!sheetName) {
    const err = new Error("Sheet title is required");
    err.code = "SHEET_NOT_FOUND";
    throw err;
  }
  if (!range.trim()) {
    const err = new Error("Range is required");
    throw err;
  }
  params.set("sheet", sheetName);
  params.set("range", range.trim());
  const url = `${GVIZ_BASE}/${encodeURIComponent(sheetId)}/gviz/tq?${params.toString()}`;

  console.debug(`[Sheets] ${feature} fetch`, { url });
  const res = await fetch(url, {
    headers: { Accept: "text/plain" }
  });
  const text = await res.text();

  if (!res.ok) {
    const err = new Error(`Failed to fetch ${feature}: ${res.status}`);
    err.status = res.status;
    if (res.status === 404) {
      err.code = "SHEET_NOT_FOUND";
    } else if (res.status === 401 || res.status === 403) {
      err.code = "SHEET_ACCESS_DENIED";
    }
    console.warn(`[Sheets] ${feature} response not ok`, {
      status: res.status,
      statusText: res.statusText
    });
    throw err;
  }

  const marker = "google.visualization.Query.setResponse(";
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    const err = new Error("Unexpected response format from Google Sheets");
    err.code = detectErrorCode(text);
    console.warn(`[Sheets] ${feature} unexpected payload`, text.slice(0, 200));
    throw err;
  }

  let jsonPayload = text.slice(markerIndex + marker.length);
  const closingIndex = jsonPayload.lastIndexOf(")");
  if (closingIndex === -1) {
    const err = new Error("Unexpected response payload termination");
    err.code = detectErrorCode(text);
    console.warn(`[Sheets] ${feature} missing closing paren`, text.slice(0, 200));
    throw err;
  }

  jsonPayload = jsonPayload.slice(0, closingIndex).trim();
  if (jsonPayload.endsWith(";")) {
    jsonPayload = jsonPayload.slice(0, -1);
  }

  let data;
  try {
    data = JSON.parse(jsonPayload);
  } catch (err) {
    err.code = detectErrorCode(text);
    err.payloadSnippet = jsonPayload.slice(0, 200);
    console.warn(`[Sheets] ${feature} JSON parse failed`, err);
    throw err;
  }

  if (data?.status !== "ok") {
    const message =
      data?.errors?.[0]?.detailed_message ||
      data?.errors?.[0]?.message ||
      data?.warnings?.[0]?.message ||
      "Failed to load sheet";
    const err = new Error(message);
    err.code = detectErrorCode(message);
    err.status = data?.status;
    console.warn(`[Sheets] ${feature} query status not ok`, data);
    throw err;
  }

  const rows = data?.table?.rows || [];
  const columnCount = data?.table?.cols?.length || 0;
  const values = rows.map((row) => {
    const cells = row?.c || [];
    const out = [];
    const effectiveColumnCount = Math.max(columnCount, cells.length);
    for (let i = 0; i < effectiveColumnCount; i++) {
      const cell = cells[i];
      let value = "";
      if (cell) {
        if (cell.f !== undefined && cell.f !== null) {
          value = cell.f;
        } else if (cell.v !== undefined && cell.v !== null) {
          value = cell.v;
        }
      }
      out.push(value);
    }
    return out;
  });

  console.debug(`[Sheets] ${feature} payload`, values.length, {
    rows: values.length,
    columns: columnCount
  });

  return values;
}

function normalizeSheetTitle(value) {
  const { normalized, display } = normalizeReferenceCellValue(value);
  return {
    normalized: normalized || "",
    display: display || ""
  };
}

export async function ensureSheetExists({ sheetId, dateStr, referenceCell = "A1" }) {
  try {
    const { column, row } = parseCellReference(referenceCell);
    const targetCell = `${column}${row}`;
    const {
      normalized: expectedNormalized,
      display: expectedDisplay
    } = normalizeSheetTitle(dateStr);
    const values = await fetchCellRange({
      sheetId,
      sheetTitle: dateStr,
      startCell: targetCell,
      endCell: targetCell,
      feature: "ensureSheetExists"
    });
    const rawCellValue = values?.[0]?.[0];
    const { normalized: cellValue, display: displayValue } = normalizeReferenceCellValue(
      rawCellValue
    );
    if (!cellValue || cellValue !== expectedNormalized) {
      const err = new Error("Sheet name cell does not match requested sheet");
      err.code = "SHEET_NAME_MISMATCH";
      err.expected = expectedDisplay || dateStr;
      err.expectedNormalized = expectedNormalized;
      err.actual = displayValue;
      err.referenceCell = targetCell;
      throw err;
    }
  } catch (err) {
    throw err;
  }

  // gvizエンドポイントから200が返ればシートは存在すると判断
}

export async function readWorkerRows(
  { sheetId, dateStr, idCol, referenceCell },
  options = {}
) {
  if (!options.skipEnsure) {
    console.debug("[Sheets] readWorkerRows running ensureSheetExists");
    await ensureSheetExists({ sheetId, dateStr, referenceCell });
  }

  const { row: baseRow } = parseCellReference(referenceCell || "A1");
  const startRow = baseRow + 1;
  const idColumn = (idCol || "A").toUpperCase();
  const nameCol = nextCol(idColumn);
  const areaCol = nextCol(nameCol);
  const aliasCol = nextCol(areaCol);

  let values;
  try {
    values = await fetchCellRange({
      sheetId,
      sheetTitle: dateStr,
      startCell: `${idColumn}${startRow}`,
      endCell: `${aliasCol}9999`,
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
    areaCol,
    aliasCol
  });

  const rowsOut = [];
  for (const row of values) {
    if (!Array.isArray(row)) continue;
    const [workerIdRaw = "", nameRaw = "", areaRaw = "", aliasRaw = ""] = row;
    const workerId = String(workerIdRaw || "").trim();
    const name = String(nameRaw || "").trim();
    const areaId = String(areaRaw || "").trim();
    const aliasCode = String(aliasRaw || "").trim();
    if (!workerId) continue;
    rowsOut.push({ workerId, name, areaId, aliasCode });
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
