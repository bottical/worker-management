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
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

export const DEFAULT_AREAS = [
  { id: "A", label: "エリアA", order: 0 },
  { id: "B", label: "エリアB", order: 1 }
];

function areaDocId(siteId, floorId) {
  return `${siteId}__${floorId}`;
}

// Firebase初期化
const app = initializeApp(ENV.firebase);
export const db = getFirestore(app);

/* =========================
 * assignments（在籍）API
 * ========================= */

/** 在籍開始（IN） */
export async function createAssignment({ siteId, floorId, areaId, workerId }){
  const ref = await addDoc(collection(db, "assignments"), {
    siteId, floorId, areaId, workerId,
    date: new Date().toISOString().slice(0,10),
    inAt: serverTimestamp(),
    outAt: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** 在籍終了（OUT） */
export async function endAssignment({ assignmentId }){
  const ref = doc(db, "assignments", assignmentId);
  await updateDoc(ref, {
    outAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

/** UI互換：closeAssignment(assignmentId) → endAssignment に委譲 */
export async function closeAssignment(assignmentId){
  return endAssignment({ assignmentId });
}

/** エリア間の異動（配置済みをドラッグ移動） */
export async function updateAssignmentArea({ assignmentId, areaId }){
  const ref = doc(db, "assignments", assignmentId);
  await updateDoc(ref, {
    areaId,
    updatedAt: serverTimestamp(),
  });
}

/** 在籍中（outAt=null）の購読：同一サイト/フロアのみ */
export function subscribeActiveAssignments({ siteId, floorId }, cb){
  const col = collection(db, "assignments");
  const q1 = query(
    col,
    where("siteId","==",siteId),
    where("floorId","==",floorId),
    where("outAt","==",null)
  );
  return onSnapshot(q1, snap => {
    const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    cb(rows);
  });
}

/** 在籍中（outAt=null）を一度だけ取得（重複IN防止用） */
export async function getActiveAssignments({ siteId, floorId }) {
  const col = collection(db, "assignments");
  const q1 = query(
    col,
    where("siteId", "==", siteId),
    where("floorId", "==", floorId),
    where("outAt", "==", null)
  );
  const snap = await getDocs(q1);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** 指定日の在籍履歴を取得（同一サイト/フロア） */
export async function getAssignmentsByDate({ siteId, floorId, date }) {
  if (!date) return [];
  const col = collection(db, "assignments");
  const q1 = query(
    col,
    where("siteId", "==", siteId),
    where("floorId", "==", floorId),
    where("date", "==", date)
  );
  const snap = await getDocs(q1);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

/* =========================
 * areaConfigs（エリア定義）API
 * ========================= */

export function subscribeAreas({ siteId, floorId }, cb) {
  const ref = doc(db, "areaConfigs", areaDocId(siteId, floorId));
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        cb(DEFAULT_AREAS.slice());
      } else {
        const data = snap.data();
        const areas = Array.isArray(data?.areas)
          ? data.areas.map((a, idx) => ({
              id: a.id || a.areaId || `Z${idx + 1}`,
              label: a.label || a.name || `エリア${a.id || idx + 1}`,
              order: typeof a.order === "number" ? a.order : idx
            }))
          : DEFAULT_AREAS.slice();
        cb(areas.sort((a, b) => (a.order ?? 0) - (b.order ?? 0)));
      }
    },
    (err) => {
      console.error("subscribeAreas failed", err);
      cb(DEFAULT_AREAS.slice());
    }
  );
}

export async function saveAreas({ siteId, floorId, areas }) {
  const sanitized = (areas || []).map((a, idx) => ({
    id: a.id,
    label: a.label,
    order: typeof a.order === "number" ? a.order : idx
  }));
  const ref = doc(db, "areaConfigs", areaDocId(siteId, floorId));
  await setDoc(
    ref,
    {
      siteId,
      floorId,
      areas: sanitized,
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
  return sanitized;
}

/* =========================
 * workers（作業者マスタ）API
 * ========================= */

export function subscribeWorkers(cb){
  const col = collection(db, "workers");
  const q1 = query(col, orderBy("name", "asc"));
  return onSnapshot(q1, snap => {
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cb(list);
  });
}

export async function upsertWorker(worker){
  const id = worker.workerId;
  const ref = doc(db, "workers", id);
  const payload = {
    workerId: id,
    name: worker.name || "",
    company: worker.company || "",
    employmentType: worker.employmentType || "",
    agency: worker.agency || "",
    skills: Array.isArray(worker.skills)
      ? worker.skills
      : (worker.skills||"").split(",").map(s=>s.trim()).filter(Boolean),
    defaultStartTime: worker.defaultStartTime || "",
    defaultEndTime: worker.defaultEndTime || "",
    active: worker.active === true || worker.active === "true" || worker.active === "on",
    panel: {
      color: (worker.panel?.color || worker.panelColor || "") || "",
      badges: Array.isArray(worker.panel?.badges)
        ? worker.panel.badges
        : (worker.badges||"").split(",").map(s=>s.trim()).filter(Boolean)
    },
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, payload, { merge: true });
  return id;
}

export async function removeWorker(workerId){
  await deleteDoc(doc(db, "workers", workerId));
}
