// pages/import.html.js
import { state, set } from "../core/store.js";
import { readWorkerRows } from "../api/sheets.js";
import {
  upsertWorker,
  createAssignment,
  getActiveAssignments,
  saveDailyRoster
} from "../api/firebase.js";
import { toast } from "../core/ui.js";

export function renderImport(mount) {
  const box = document.createElement("div");
  box.className = "panel";
  box.innerHTML = `
    <h2>スプレッドシート取り込み</h2>
    <div class="form grid twocol">
      <label>シートID<input id="sheetId" placeholder="1abc..."/></label>
      <label>シート名（日付）<input id="dateStr" placeholder="2025-11-04"/></label>
      <label>ID列（A等）<input id="idCol" placeholder="A"/></label>
      <label>ヘッダー行
        <select id="hasHeader">
          <option value="1" selected>あり</option>
          <option value="0">なし</option>
        </select>
      </label>
    </div>
    <div class="form-actions">
      <button id="run" class="button">取り込む</button>
    </div>
    <div id="result" class="hint"></div>
  `;
  mount.appendChild(box);

  // 既定値をストアから復元
  box.querySelector("#sheetId").value = state.sheetId || "";
  box.querySelector("#dateStr").value = state.dateTab || "";
  box.querySelector("#idCol").value = state.idColumn || "A";
  box.querySelector("#hasHeader").value = state.hasHeader ? "1" : "0";

  box.querySelector("#run").addEventListener("click", async () => {
    const sheetId = box.querySelector("#sheetId").value.trim();
    const dateStr = box.querySelector("#dateStr").value.trim();
    const col = (box.querySelector("#idCol").value || "A").trim().toUpperCase();
    const hasHeader = box.querySelector("#hasHeader").value === "1";

    if (!sheetId || !dateStr) {
      toast("シートIDとシート名（日付）を入力してください");
      return;
    }

    try {
      const { ids, rows, duplicates } = await readWorkerRows({
        sheetId,
        dateStr,
        idCol: col,
        hasHeader
      });

      if (!rows.length) {
        toast("シートに作業者が見つかりませんでした", "error");
        return;
      }

      // マスタUpsert
      let newOrUpdated = 0;
      for (const r of rows) {
        await upsertWorker({
          workerId: r.workerId,
          name: r.name,
          active: true
        });
        newOrUpdated++;
      }

      // 自動IN：基本エリアが入っている人のみ（同一サイト・フロアで在籍中判定）
      const activeNow = await getActiveAssignments(state.site);
      const assignedSet = new Set(activeNow.map((a) => a.workerId));
      const toAssign = rows.filter(
        (r) => r.areaId && !assignedSet.has(r.workerId)
      );

      for (const r of toAssign) {
        try {
          await createAssignment({
            siteId: state.site.siteId,
            floorId: state.site.floorId,
            areaId: r.areaId,
            workerId: r.workerId
          });
        } catch (e) {
          console.warn("auto-assign failed", r.workerId, e);
        }
      }

      try {
        await saveDailyRoster({
          siteId: state.site.siteId,
          floorId: state.site.floorId,
          date: dateStr,
          workers: rows
        });
      } catch (err) {
        console.error("saveDailyRoster failed", err);
        toast("日次の作業者リストの保存に失敗しました", "error");
      }

      // ストア更新（workersを丸ごと保存してDashboard初期描画にも反映）
      set({
        sheetId,
        dateTab: dateStr,
        idColumn: col,
        hasHeader,
        workers: rows
      });

      const autoInCount = toAssign.length;
      const dupNote = duplicates.length ? `／重複ID:${duplicates.join(",")}` : "";
      box.querySelector("#result").textContent = `取り込み成功：${ids.length}名（upsert:${newOrUpdated}件／自動配置:${autoInCount}件）${dupNote}`;
      toast(`取り込み成功：${ids.length}名（upsert:${newOrUpdated}件／自動配置:${autoInCount}件）`);
    } catch (err) {
      console.error(err);
      if (err?.code === "SHEET_NOT_FOUND") {
        toast(`シート「${dateStr}」が見つかりません。日付を確認してください。`, "error");
      } else {
        toast("取り込みに失敗しました。設定をご確認ください。", "error");
      }
    }
  });
}
