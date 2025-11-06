// pages/import.html.js
import { state, set } from "../core/store.js";
import { ensureSheetExists, readWorkerRows } from "../api/sheets.js";
import {
  upsertWorker,
  createAssignment,
  getActiveAssignments,
  saveDailyRoster
} from "../api/firebase.js";
import { toast } from "../core/ui.js";

const DEFAULT_START = "09:00";
const DEFAULT_END = "18:00";

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
    <div class="form-actions" style="align-items:center;gap:12px">
      <button id="run" class="button">取り込む</button>
      <div id="progress" class="loading-indicator" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <span>取り込み中...</span>
      </div>
    </div>
    <div id="result" class="hint"></div>
  `;
  mount.appendChild(box);

  // 既定値をストアから復元
  box.querySelector("#sheetId").value = state.sheetId || "";
  box.querySelector("#dateStr").value = state.dateTab || "";
  box.querySelector("#idCol").value = state.idColumn || "A";
  box.querySelector("#hasHeader").value = state.hasHeader ? "1" : "0";

  const runBtn = box.querySelector("#run");
  const progress = box.querySelector("#progress");
  const result = box.querySelector("#result");

  const setLoading = (loading) => {
    runBtn.disabled = loading;
    progress.classList.toggle("active", loading);
    progress.setAttribute("aria-hidden", loading ? "false" : "true");
    progress.hidden = !loading;
    if (loading) {
      result.textContent = "";
    }
  };

  runBtn.addEventListener("click", async () => {
    console.groupCollapsed("[Import] run clicked");
    if (!state.site?.userId || !state.site?.siteId) {
      console.warn("[Import] missing site context", state.site);
      toast("ログインし、サイトを選択してください", "error");
      console.groupEnd();
      return;
    }
    const sheetId = box.querySelector("#sheetId").value.trim();
    const dateStr = box.querySelector("#dateStr").value.trim();
    const col = (box.querySelector("#idCol").value || "A").trim().toUpperCase();
    const hasHeader = box.querySelector("#hasHeader").value === "1";

    console.info("[Import] parameters", {
      sheetId: sheetId.slice(0, 6) + (sheetId.length > 6 ? "…" : ""),
      dateStr,
      col,
      hasHeader
    });

    if (!sheetId || !dateStr) {
      console.warn("[Import] missing required fields", { sheetId, dateStr });
      toast("シートIDとシート名（日付）を入力してください");
      console.groupEnd();
      return;
    }

    setLoading(true);

    try {
      console.info("[Import] ensuring sheet exists");
      await ensureSheetExists({ sheetId, dateStr });
      console.info("[Import] sheet verified");
    } catch (err) {
      console.error("[Import] ensureSheetExists failed", err);
      let message;
      if (err?.code === "SHEET_NOT_FOUND") {
        const suggestions = Array.isArray(err.availableSheets)
          ? err.availableSheets.join(", ")
          : "";
        message = `シート「${dateStr}」が見つかりません。日付を確認してください。`;
        if (suggestions) {
          const hint = `利用可能なシート: ${suggestions}`;
          console.info("[Import] available sheets", err.availableSheets);
          message += `\n${hint}`;
        }
      } else {
        message = "指定されたシートの確認に失敗しました。設定をご確認ください。";
      }

      toast(message, "error");
      result.textContent = message;
      setLoading(false);
      console.groupEnd();
      return;
    }

    try {
      console.info("[Import] reading worker rows");
      const { ids, rows, duplicates } = await readWorkerRows(
        {
          sheetId,
          dateStr,
          idCol: col,
          hasHeader
        },
        { skipEnsure: true }
      );

      console.info("[Import] rows fetched", {
        idCount: ids.length,
        rowCount: rows.length,
        duplicates
      });

      if (!rows.length) {
        console.warn("[Import] no workers found");
        toast("シートに作業者が見つかりませんでした", "error");
        setLoading(false);
        console.groupEnd();
        return;
      }

      // マスタUpsert
      let newOrUpdated = 0;
      console.info("[Import] upserting workers", rows.length);
      for (const r of rows) {
        await upsertWorker({
          userId: state.site.userId,
          siteId: state.site.siteId,
          workerId: r.workerId,
          name: r.name,
          active: true,
          defaultStartTime: r.defaultStartTime || DEFAULT_START,
          defaultEndTime: r.defaultEndTime || DEFAULT_END
        });
        newOrUpdated++;
      }

      // 自動IN：基本エリアが入っている人のみ（同一サイト・フロアで在籍中判定）
      const activeNow = await getActiveAssignments({
        userId: state.site.userId,
        siteId: state.site.siteId,
        floorId: state.site.floorId
      });
      const assignedSet = new Set(activeNow.map((a) => a.workerId));
      const toAssign = rows.filter(
        (r) => r.areaId && !assignedSet.has(r.workerId)
      );

      console.info("[Import] auto-assign candidates", {
        activeAssignments: activeNow.length,
        candidates: toAssign.length
      });

      let autoAssignFailures = 0;
      for (const r of toAssign) {
        try {
          await createAssignment({
            userId: state.site.userId,
            siteId: state.site.siteId,
            floorId: state.site.floorId,
            areaId: r.areaId,
            workerId: r.workerId
          });
        } catch (e) {
          console.warn("[Import] auto-assign failed", r.workerId, e);
          autoAssignFailures++;
        }
      }

      console.info("[Import] auto-assign complete", {
        attempted: toAssign.length,
        failed: autoAssignFailures
      });

      if (autoAssignFailures > 0) {
        toast(
          `自動配置に失敗した作業者が${autoAssignFailures}名います。手動でご確認ください。`,
          "error"
        );
      }

      try {
        await saveDailyRoster({
          userId: state.site.userId,
          siteId: state.site.siteId,
          floorId: state.site.floorId,
          date: dateStr,
          workers: rows
        });
      } catch (err) {
        console.error("[Import] saveDailyRoster failed", err);
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
      result.textContent = `取り込み成功：${ids.length}名（upsert:${newOrUpdated}件／自動配置:${autoInCount}件）${dupNote}`;
      toast(`取り込み成功：${ids.length}名（upsert:${newOrUpdated}件／自動配置:${autoInCount}件）`);
    } catch (err) {
      console.error("[Import] unexpected failure", err);
      const message =
        err?.code === "SHEET_NOT_FOUND"
          ? `シート「${dateStr}」が見つかりません。日付を確認してください。`
          : "取り込みに失敗しました。設定をご確認ください。";
      toast(message, "error");
      result.textContent = message;
    } finally {
      setLoading(false);
      console.groupEnd();
    }
  });
}
