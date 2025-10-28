import { state, set } from "../core/store.js";
import { readWorkerIds } from "../api/sheets.js";
import { toast } from "../core/ui.js";

export function renderImport(mount){
  const box = document.createElement("div");
  box.className = "panel";
  box.innerHTML = `
    <h2>スプレッドシートから取り込み</h2>
    <div class="grid" style="grid-template-columns:1fr 220px 120px 160px;gap:8px">
      <label>シートID
        <input id="sheetId" placeholder="1A2b3C..." value="${state.sheetId||""}">
      </label>
      <label>日付タブ
        <input id="date" type="date" value="${state.dateTab}">
      </label>
      <label>列
        <input id="col" value="${state.idColumn||"A"}" maxlength="2">
      </label>
      <label>ヘッダー
        <select id="hdr"><option value="1" selected>1行目はヘッダー</option><option value="0">なし</option></select>
      </label>
    </div>
    <div style="margin-top:8px;display:flex;gap:8px">
      <button id="load" class="button">読み込み</button>
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
      const ids = await readWorkerIds({ sheetId, dateStr, col, hasHeader });
      set({ sheetId, dateTab: dateStr, idColumn: col, hasHeader, workers: ids, placed: new Map() });
      box.querySelector("#result").textContent = `読み込み：${ids.length}名`;
      toast(`取り込み成功：${ids.length}名`);
      location.hash = "#/dashboard";
    }catch(e){
      toast(e.message || "読み込みエラー","error");
    }
  };
}
