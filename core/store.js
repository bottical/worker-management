import { ENV } from "../config/env.js";

const listeners = new Set();

function getLocalSheetsApiKey() {
  if (typeof window === "undefined" || !window?.localStorage) {
    return "";
  }
  try {
    return window.localStorage.getItem("sheetsApiKey") || "";
  } catch (err) {
    console.warn("[store] failed to read sheetsApiKey from localStorage", err);
    return "";
  }
}

function persistLocalSheetsApiKey(value) {
  if (typeof window === "undefined" || !window?.localStorage) {
    return;
  }
  try {
    if (value && value.length > 0) {
      window.localStorage.setItem("sheetsApiKey", value);
    } else {
      window.localStorage.removeItem("sheetsApiKey");
    }
  } catch (err) {
    console.warn("[store] failed to persist sheetsApiKey", err);
  }
}

export const state = {
  sheetId: ENV.sheetId,
  dateTab: new Date().toISOString().slice(0, 10),
  idColumn: ENV.idColumn,
  hasHeader: ENV.hasHeader,
  sheetsApiKey: getLocalSheetsApiKey() || ENV.sheetsApiKey || "",
  workers: [], // ["ID001", ...]
  placed: new Map(), // workerId -> { zone: "A"|"B", assignmentId }
  user: null, // { uid, email, displayName }
  sites: [], // [{ id, label, defaultFloorId }]
  site: {
    userId: null,
    siteId: ENV.defaultSite?.siteId || "",
    floorId: ENV.defaultSite?.floorId || ""
  },
  assignmentDate: new Date().toISOString().slice(0, 10)
};

export function set(partial) {
  Object.assign(state, partial);
  if (Object.prototype.hasOwnProperty.call(partial, "sheetsApiKey")) {
    persistLocalSheetsApiKey(partial.sheetsApiKey || "");
  }
  listeners.forEach((fn) => {
    try {
      fn(state, partial);
    } catch (err) {
      console.warn("store subscriber failed", err);
    }
  });
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
