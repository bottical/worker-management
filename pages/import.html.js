import { state, set } from "../core/store.js";
import { readWorkerIdNamePairs } from "../api/sheets.js";
import { upsertWorker } from "../api/firebase.js";
import { toast } from "../core/ui.js";

export function renderImport(mount){
  const box = document.createElement("div");
  box.className = "panel";
  box.innerHTML = `
    <h2>スプレッドシートから取り込み</h2>
    <div class="grid" style="grid-template-columns:1fr 220px 120px 160px;gap:8px;margin-bottom:8px">
      <label>シートID
        <input id="sheetId" placeholder="1A2b3C..." value="${state.sheetId||""}">
      </label>
      <label>日付タブ
        <input id="date" type="date" value="${state.dateTab}">
      </label>
      <label>ID列
        <input id="col" value="${state.idColumn||"A"}" maxlength="2">
      </label>
      <label>ヘッダー
        <select id="hdr"><option value="1" ${state.hasHeader?"selected":""}>1行目はヘッダー</option><option value="0" ${!state.hasHeader?"selected":""}>なし</option></select>
      </label>
    </div>
    <div style="display:flex;gap:8px">
      <button id="load" class="button">取り込み（ID＋名前）</button>
    </div>
    <div id="result" class="muted" style="margin-top:8px"></div>
  `;
  mount.appendChild(box);

  box.querySelector("#load").onclick = async () => {
    const sheetId = box.querySelector("#sheetId").value.trim();
    const dateStr = box.querySelector("#date").value.trim();
    const col = box.querySelector("#col").value.trim().toUpperCase();
    const hasHeader = box.querySelector("#hdr").value === "1";
    if(!sheetId || !dateStr || !/^[A-Z]{1,2}$/.test(col)) { toast("入力を確認してください","error"); return; }

    try{
      const { ids, pairs, duplicates } = await readWorkerIdNamePairs({ sheetId, dateStr, idCol: col, hasHeader });

      if (duplicates.length > 0) {
        toast(`重複IDを検出：${duplicates.join(", ")}`, "error");
        box.querySelector("#result").textContent = `重複ID：${duplicates.join(", ")}（取り込みを中断しました）`;
        return;
      }

      // DBに upsert（name を反映）
      let newOrUpdated = 0;
      for (const p of pairs) {
        await upsertWorker({ workerId: p.workerId, name: p.name, active: true });
        newOrUpdated++;
      }

      set({ sheetId, dateTab: dateStr, idColumn: col, hasHeader, workers: ids });
      box.querySelector("#result").textContent = `取り込み成功：${ids.length}名（upsert: ${newOrUpdated}件）`;
      toast(`取り込み成功：${ids.length}名（upsert: ${newOrUpdated}件）`);
      location.hash = "#/dashboard";
    }catch(e){
      console.error(e);
      toast(e.message || "読み込みエラー","error");
    }
  };
}
