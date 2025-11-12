// api/firebase.js
import { ENV } from "../config/env.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore,
  collection,
  addDoc,
  setDoc,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  query,
  where,
  onSnapshot,
  orderBy,
  getDocs,
  getDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-auth.js";

export const DEFAULT_AREAS = [
  { id: "A", label: "エリアA", order: 0 },
  { id: "B", label: "エリアB", order: 1 }
];

export const DEFAULT_FLOORS = [
  { id: "1F", label: "1F", order: 0 }
];

function areaDocId(siteId, floorId) {
  return `${siteId}__${floorId || "default"}`;
}

function floorDocId(siteId) {
  return `${siteId}`;
}

function rosterDocId(siteId, floorId, date) {
  return `${siteId}__${floorId}__${date}`;
}

// Firebase初期化
const app = initializeApp(ENV.firebase);
export const db = getFirestore(app);
export const auth = getAuth(app);

function assertUserSite({ userId, siteId }) {
  if (!userId) throw new Error("userId is required");
  if (!siteId) throw new Error("siteId is required");
}

function normalizedDefaultFloors(defaultFloorId) {
  const provided = (ENV.defaultSite?.floors || []).filter(Boolean);
  const merged = provided.length ? provided : DEFAULT_FLOORS;
  const seen = new Set();
  const list = merged
    .map((f, idx) => ({
      id: f.id || f.floorId || `F${idx + 1}`,
      label: f.label || f.name || f.id || `F${idx + 1}`,
      order: typeof f.order === "number" ? f.order : idx
    }))
    .filter((f) => {
      if (!f.id || seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    });
  if (defaultFloorId && !seen.has(defaultFloorId)) {
    list.unshift({ id: defaultFloorId, label: defaultFloorId, order: -1 });
  }
  return list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((f, idx) => ({
    id: f.id,
    label: f.label,
    order: typeof f.order === "number" ? f.order : idx
  }));
}

function normalizedDefaultAreas() {
  const provided = (ENV.defaultSite?.areas || []).filter(Boolean);
  const merged = provided.length ? provided : DEFAULT_AREAS;
  const seen = new Set();
  return merged
    .map((a, idx) => ({
      id: a.id || a.areaId || `Z${idx + 1}`,
      label: a.label || a.name || a.id || `エリア${idx + 1}`,
      order: typeof a.order === "number" ? a.order : idx
    }))
    .filter((a) => {
      if (!a.id || seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    })
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((a, idx) => ({
      id: a.id,
      label: a.label,
      order: typeof a.order === "number" ? a.order : idx
    }));
}

export async function ensureDefaultSiteForUser(userId) {
  if (!userId) return null;
  const configured = ENV.defaultSite || {};
  const siteId = configured.siteId || "site1";
  const defaultFloorId = configured.floorId || DEFAULT_FLOORS[0]?.id || "";
  const label = configured.label || configured.name || "デフォルトサイト";

  const siteRef = siteDocRef(userId, siteId);
  const siteSnap = await getDoc(siteRef);
  if (!siteSnap.exists()) {
    await setDoc(
      siteRef,
      {
        siteId,
        label,
        defaultFloorId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  const floorsRef = siteDocument(userId, siteId, "floorConfigs", floorDocId(siteId));
  const floorsSnap = await getDoc(floorsRef);
  if (!floorsSnap.exists()) {
    const floors = normalizedDefaultFloors(defaultFloorId);
    await setDoc(
      floorsRef,
      {
        siteId,
        floors,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  const areasRef = siteDocument(userId, siteId, "areaConfigs", areaDocId(siteId, defaultFloorId || ""));
  const areasSnap = await getDoc(areasRef);
  if (!areasSnap.exists()) {
    const areas = normalizedDefaultAreas();
    await setDoc(
      areasRef,
      {
        siteId,
        floorId: defaultFloorId || "",
        areas,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );
  }

  return siteId;
}

function siteDocRef(userId, siteId) {
  assertUserSite({ userId, siteId });
  return doc(db, "users", userId, "sites", siteId);
}

function siteCollection(userId, siteId, collectionName) {
  assertUserSite({ userId, siteId });
  return collection(db, "users", userId, "sites", siteId, collectionName);
}

function siteDocument(userId, siteId, collectionName, documentId) {
  assertUserSite({ userId, siteId });
  return doc(db, "users", userId, "sites", siteId, collectionName, documentId);
}

async function ensureSiteMetadata(userId, siteId, extra = {}) {
  const ref = siteDocRef(userId, siteId);
  await setDoc(
    ref,
    {
      siteId,
      ...extra,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

export function onAuthState(cb) {
  return onAuthStateChanged(auth, cb);
}

export function loginWithEmailPassword(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function logout() {
  return signOut(auth);
}

export function subscribeSites(userId, cb) {
  if (!userId) {
    cb([]);
    return () => {};
  }
  const col = collection(db, "users", userId, "sites");
  return onSnapshot(
    col,
    (snap) => {
      const list = snap.docs.map((d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          label: data.label || data.name || d.id,
          defaultFloorId: data.defaultFloorId || data.defaultFloor || "",
          ...data
        };
      });
      cb(list);
    },
    (err) => {
      console.error("subscribeSites failed", err);
      cb([]);
    }
  );
}

/* =========================
 * assignments（在籍）API
 * ========================= */

/** 在籍開始（IN） */
export async function createAssignment({ userId, siteId, floorId, areaId, workerId }) {
  assertUserSite({ userId, siteId });
  if (!workerId) throw new Error("workerId is required");
  await ensureSiteMetadata(userId, siteId);
  const col = siteCollection(userId, siteId, "assignments");
  const batch = writeBatch(db);
  const duplicatesQuery = query(
    col,
    where("workerId", "==", workerId),
    where("outAt", "==", null)
  );
  const dupSnap = await getDocs(duplicatesQuery);
  dupSnap.forEach((docSnap) => {
    batch.update(docSnap.ref, {
      outAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      closedReason: "reassigned"
    });
  });
  if (!dupSnap.empty) {
    await batch.commit();
  }
  const payload = {
    userId,
    siteId,
    floorId: floorId || "",
    areaId: areaId || "",
    workerId,
    date: new Date().toISOString().slice(0, 10),
    inAt: serverTimestamp(),
    outAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };
  const ref = await addDoc(col, payload);
  return ref.id;
}

/** 在籍終了（OUT） */
export async function endAssignment({ userId, siteId, assignmentId }) {
  assertUserSite({ userId, siteId });
  if (!assignmentId) return;
  const ref = siteDocument(userId, siteId, "assignments", assignmentId);
  await updateDoc(ref, {
    outAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

/** UI互換：closeAssignment → endAssignment に委譲 */
export async function closeAssignment({ userId, siteId, assignmentId }) {
  return endAssignment({ userId, siteId, assignmentId });
}

/** エリア間の異動（配置済みをドラッグ移動） */
export async function updateAssignmentArea({ userId, siteId, assignmentId, areaId }) {
  assertUserSite({ userId, siteId });
  if (!assignmentId) return;
  const ref = siteDocument(userId, siteId, "assignments", assignmentId);
  await updateDoc(ref, {
    areaId,
    updatedAt: serverTimestamp()
  });
}

/** 在籍中（outAt=null）の購読：同一サイト/フロアのみ */
export function subscribeActiveAssignments({ userId, siteId, floorId }, cb) {
  assertUserSite({ userId, siteId });
  const col = siteCollection(userId, siteId, "assignments");
  const filters = [where("outAt", "==", null)];
  if (floorId) {
    filters.push(where("floorId", "==", floorId));
  }
  const q1 = query(col, ...filters);
  return onSnapshot(q1, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cb(rows);
  });
}

/** 在籍中（outAt=null）を一度だけ取得（重複IN防止用） */
export async function getActiveAssignments({ userId, siteId, floorId }) {
  assertUserSite({ userId, siteId });
  const col = siteCollection(userId, siteId, "assignments");
  const filters = [where("outAt", "==", null)];
  if (floorId) {
    filters.push(where("floorId", "==", floorId));
  }
  const q1 = query(col, ...filters);
  const snap = await getDocs(q1);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** 指定日の在籍履歴を取得（同一サイト/フロア） */
export async function getAssignmentsByDate({ userId, siteId, floorId, date }) {
  if (!date) return [];
  assertUserSite({ userId, siteId });
  const col = siteCollection(userId, siteId, "assignments");
  const filters = [where("date", "==", date)];
  if (floorId) {
    filters.push(where("floorId", "==", floorId));
  }
  const q1 = query(col, ...filters);
  const snap = await getDocs(q1);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* =========================
 * areaConfigs（エリア定義）API
 * ========================= */

export async function getAreasOnce({ userId, siteId, floorId }) {
  assertUserSite({ userId, siteId });
  const ref = siteDocument(userId, siteId, "areaConfigs", areaDocId(siteId, floorId || ""));
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return floorId ? [] : normalizedDefaultAreas();
  }
  const data = snap.data();
  if (!Array.isArray(data?.areas)) {
    return floorId ? [] : normalizedDefaultAreas();
  }
  return data.areas
    .map((a, idx) => ({
      id: a.id || a.areaId || `Z${idx + 1}`,
      label: a.label || a.name || `エリア${a.id || idx + 1}`,
      order: typeof a.order === "number" ? a.order : idx
    }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function subscribeAreas({ userId, siteId, floorId }, cb) {
  assertUserSite({ userId, siteId });
  const ref = siteDocument(userId, siteId, "areaConfigs", areaDocId(siteId, floorId || ""));
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        cb(floorId ? [] : DEFAULT_AREAS.slice());
      } else {
        const data = snap.data();
        const areas = Array.isArray(data?.areas)
          ? data.areas.map((a, idx) => ({
              id: a.id || a.areaId || `Z${idx + 1}`,
              label: a.label || a.name || `エリア${a.id || idx + 1}`,
              order: typeof a.order === "number" ? a.order : idx
            }))
          : floorId
          ? []
          : DEFAULT_AREAS.slice();
        cb(areas.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
      }
    },
    (err) => {
      console.error("subscribeAreas failed", err);
      cb(floorId ? [] : DEFAULT_AREAS.slice());
    }
  );
}

export async function saveAreas({ userId, siteId, floorId, areas }) {
  assertUserSite({ userId, siteId });
  const sanitized = (areas || []).map((a, idx) => ({
    id: a.id,
    label: a.label,
    order: typeof a.order === "number" ? a.order : idx
  }));
  await ensureSiteMetadata(userId, siteId);
  const ref = siteDocument(userId, siteId, "areaConfigs", areaDocId(siteId, floorId || ""));
  await setDoc(
    ref,
    {
      siteId,
      floorId: floorId || "",
      areas: sanitized,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  return sanitized;
}

/* =========================
 * floorConfigs（フロア定義）API
 * ========================= */

export async function getFloorsOnce({ userId, siteId }) {
  assertUserSite({ userId, siteId });
  const ref = siteDocument(userId, siteId, "floorConfigs", floorDocId(siteId));
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return normalizedDefaultFloors();
  }
  const data = snap.data();
  if (!Array.isArray(data?.floors)) {
    return normalizedDefaultFloors();
  }
  return data.floors
    .map((f, idx) => ({
      id: f.id || f.floorId || `F${idx + 1}`,
      label: f.label || f.name || f.id || `F${idx + 1}`,
      order: typeof f.order === "number" ? f.order : idx
    }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function subscribeFloors({ userId, siteId }, cb) {
  assertUserSite({ userId, siteId });
  const ref = siteDocument(userId, siteId, "floorConfigs", floorDocId(siteId));
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        cb(DEFAULT_FLOORS.slice());
      } else {
        const data = snap.data();
        const floors = Array.isArray(data?.floors)
          ? data.floors.map((f, idx) => ({
              id: f.id || f.floorId || `F${idx + 1}`,
              label: f.label || f.name || f.id || `F${idx + 1}`,
              order: typeof f.order === "number" ? f.order : idx
            }))
          : DEFAULT_FLOORS.slice();
        cb(floors.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
      }
    },
    (err) => {
      console.error("subscribeFloors failed", err);
      cb(DEFAULT_FLOORS.slice());
    }
  );
}

export async function saveFloors({ userId, siteId, floors, siteLabel }) {
  assertUserSite({ userId, siteId });
  const sanitized = (floors || []).map((f, idx) => ({
    id: f.id,
    label: f.label,
    order: typeof f.order === "number" ? f.order : idx
  }));
  const defaultFloorId = sanitized[0]?.id || "";
  await ensureSiteMetadata(userId, siteId, {
    label: siteLabel || undefined,
    defaultFloorId
  });
  const ref = siteDocument(userId, siteId, "floorConfigs", floorDocId(siteId));
  await setDoc(
    ref,
    {
      siteId,
      floors: sanitized,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  return sanitized;
}

/* =========================
 * dailyRosters（日次シートの作業者）API
 * ========================= */

export async function saveDailyRoster({ userId, siteId, floorId, date, workers }) {
  assertUserSite({ userId, siteId });
  const sanitized = (workers || []).map((w) => ({
    workerId: w.workerId,
    name: w.name || "",
    areaId: w.areaId || ""
  }));
  await ensureSiteMetadata(userId, siteId);
  const ref = siteDocument(userId, siteId, "dailyRosters", rosterDocId(siteId, floorId || "", date));
  await setDoc(
    ref,
    {
      siteId,
      floorId: floorId || "",
      date,
      workers: sanitized,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  return sanitized;
}

export async function getDailyRoster({ userId, siteId, floorId, date }) {
  assertUserSite({ userId, siteId });
  if (!date) return { workers: [] };
  const ref = siteDocument(userId, siteId, "dailyRosters", rosterDocId(siteId, floorId || "", date));
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    return { workers: [] };
  }
  const data = snap.data() || {};
  const workers = Array.isArray(data.workers)
    ? data.workers.map((w) => ({
        workerId: w.workerId,
        name: w.name || w.workerId,
        areaId: w.areaId || ""
      }))
    : [];
  return { workers };
}

/* =========================
 * workers（作業者マスタ）API
 * ========================= */

export async function getWorkersOnce({ userId, siteId }) {
  assertUserSite({ userId, siteId });
  const col = siteCollection(userId, siteId, "workers");
  const snap = await getDocs(col);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

export function subscribeWorkers({ userId, siteId }, cb) {
  assertUserSite({ userId, siteId });
  const col = siteCollection(userId, siteId, "workers");
  const q1 = query(col, orderBy("name", "asc"));
  return onSnapshot(q1, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    cb(list);
  });
}

export async function upsertWorker({ userId, siteId, ...worker }) {
  assertUserSite({ userId, siteId });
  const id = worker.workerId;
  if (!id) throw new Error("workerId is required");
  await ensureSiteMetadata(userId, siteId);
  const ref = siteDocument(userId, siteId, "workers", id);
  const payload = {
    workerId: id,
    name: worker.name || "",
    company: worker.company || "",
    employmentType: worker.employmentType || "",
    agency: worker.agency || "",
    skills: Array.isArray(worker.skills)
      ? worker.skills
      : (worker.skills || "").split(",").map((s) => s.trim()).filter(Boolean),
    defaultStartTime: worker.defaultStartTime || "",
    defaultEndTime: worker.defaultEndTime || "",
    active: worker.active === true || worker.active === "true" || worker.active === "on",
    panel: {
      color: (worker.panel?.color || worker.panelColor || "") || "",
      badges: Array.isArray(worker.panel?.badges)
        ? worker.panel.badges
        : (worker.badges || "").split(",").map((s) => s.trim()).filter(Boolean)
    },
    updatedAt: serverTimestamp()
  };
  await setDoc(ref, payload, { merge: true });
  return id;
}

export async function removeWorker({ userId, siteId, workerId }) {
  assertUserSite({ userId, siteId });
  if (!workerId) return;
  const ref = siteDocument(userId, siteId, "workers", workerId);
  await deleteDoc(ref);
}
