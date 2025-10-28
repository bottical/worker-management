import { ENV } from "../config/env.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore, collection, addDoc, setDoc, doc, updateDoc, deleteDoc,
  serverTimestamp, query, where, onSnapshot, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

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

/** エリア間の異動（配置済みをドラッグ移動） */
export async function updateAssignmentArea({ assignmentId, areaId }){
  const ref = doc(db, "assignments", assignmentId);
  await updateDoc(ref, {
    areaId,
    updatedAt: serverTimestamp(),
  });
}

/** 在籍中（outAt=null）の購読：同一サイト/フロアのみ */
export function subscribeAssignments({ siteId, floorId }, cb){
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
    defaultStartTime: worker.defaultStartTime || "",   // ← 追加
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
