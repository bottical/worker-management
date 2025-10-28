import { ENV } from "../config/env.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.4/firebase-app.js";
import {
  getFirestore, collection, addDoc, serverTimestamp, query, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.4/firebase-firestore.js";

// Firebase初期化
const app = initializeApp(ENV.firebase);
export const db = getFirestore(app);

/**
 * 在籍開始（assignmentを作成）
 * @param {Object} p {siteId,floorId,areaId,workerId}
 * @returns docRef.id
 */
export async function createAssignment({ siteId, floorId, areaId, workerId }){
  const ref = await addDoc(collection(db, "assignments"), {
    siteId, floorId, areaId, workerId,
    inAt: serverTimestamp(),
    outAt: null,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

/**
 * 当日・指定エリアの割当を購読（簡易）
 * 今回は「outAtがnullの在籍中のみ」を購読
 */
export function subscribeAssignments({ siteId, floorId }, cb){
  const today = new Date().toISOString().slice(0,10); // 簡易（日付境界は本実装で拡張）
  const col = collection(db, "assignments");
  const q1 = query(col,
    where("siteId","==",siteId),
    where("floorId","==",floorId),
    where("outAt","==",null)
  );
  // 実用では date フィールドを別途持たせて where("date","==",today) を推奨
  return onSnapshot(q1, snap => {
    const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    cb(rows);
  });
}
