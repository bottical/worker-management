import { ENV } from "../config/env.js";
import { getJstDateString } from "./dates.js";

const listeners = new Set();

export const state = {
  sheetId: ENV.sheetId,
  dateTab: getJstDateString(),
  idColumn: ENV.idColumn,
  referenceCell: ENV.referenceCell || "A1",
  workers: [], // ["ID001", ...]
  placed: new Map(), // workerId -> { zone: "A"|"B", assignmentId }
  user: null, // { uid, email, displayName }
  sites: [], // [{ id, label, defaultFloorId }]
  site: {
    userId: null,
    siteId: ENV.defaultSite?.siteId || "",
    floorId: ENV.defaultSite?.floorId || ""
  },
  assignmentDate: getJstDateString()
};

export function set(partial) {
  Object.assign(state, partial);
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
