import { ENV } from "../config/env.js";

export const state = {
  sheetId: ENV.sheetId,
  dateTab: new Date().toISOString().slice(0,10),
  idColumn: ENV.idColumn,
  hasHeader: ENV.hasHeader,
  workers: [],                   // ["ID001", ...]
  placed: new Map(),             // workerId -> { zone: "A"|"B", assignmentId }
  site: ENV.defaultSite,         // {siteId, floorId}
  assignmentDate: new Date().toISOString().slice(0,10),
};

export function set(partial){
  Object.assign(state, partial);
}
