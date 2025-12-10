// pages/import.html.js
import { state, set } from "../core/store.js";
import { ensureSheetExists, readWorkerRows } from "../api/sheets.js";
import {
  upsertWorker,
  getWorkersOnce,
  createAssignment,
  getActiveAssignments,
  saveDailyRoster,
  getFloorsOnce,
  getAreasOnce
} from "../api/firebase.js";
import { toast } from "../core/ui.js";

const DEFAULT_START = "09:00";
const DEFAULT_END = "18:00";

const AREA_FLOOR_SEPARATORS = [":", "：", "/", "／", ">", "@", "|"];

function parseFloorPrefixedArea(rawValue, knownFloors) {
  const value = String(rawValue || "").trim();
  if (!value || !knownFloors?.size) {
    return null;
  }
  for (const sep of AREA_FLOOR_SEPARATORS) {
    const idx = value.indexOf(sep);
    if (idx > 0 && idx < value.length - 1) {
      const floorCandidate = value.slice(0, idx).trim();
      const areaCandidate = value.slice(idx + 1).trim();
      if (areaCandidate && knownFloors.has(floorCandidate)) {
        return { floorId: floorCandidate, areaId: areaCandidate };
      }
    }
  }
  const hyphenMatch = value.match(/^(\S+)\s*-\s*(\S.*)$/);
  if (hyphenMatch) {
    const [, floorCandidate, areaCandidate] = hyphenMatch;
    if (areaCandidate && knownFloors.has(floorCandidate)) {
      return { floorId: floorCandidate, areaId: areaCandidate.trim() };
    }
  }
  const spaceMatch = value.match(/^(\S+)\s+(\S.*)$/);
  if (spaceMatch) {
    const [, floorCandidate, areaCandidate] = spaceMatch;
    if (areaCandidate && knownFloors.has(floorCandidate)) {
      return { floorId: floorCandidate, areaId: areaCandidate.trim() };
    }
  }
  return null;
}

async function resolveRowsWithFloors(rows, { userId, siteId, defaultFloorId }) {
  const normalizedRows = Array.isArray(rows) ? rows.map((r) => ({ ...r })) : [];
  if (!userId || !siteId || !normalizedRows.length) {
    return {
      rows: normalizedRows.map((r) => ({ ...r, floorId: r.floorId || "" })),
      ambiguous: [],
      unresolved: [],
      knownFloors: [],
      missingIndexes: []
    };
  }

  const areaToFloors = new Map();
  const floorSet = new Set();
  try {
    const floors = await getFloorsOnce({ userId, siteId });
    floors
      .map((f) => f?.id)
      .filter(Boolean)
      .forEach((id) => floorSet.add(id));

    await Promise.all(
      Array.from(floorSet).map(async (floorId) => {
        const payload = await getAreasOnce({ userId, siteId, floorId });
        const areas = Array.isArray(payload?.areas) ? payload.areas : payload;
        (areas || [])
          .map((a) => a?.id)
          .filter(Boolean)
          .forEach((areaId) => {
            const existing = areaToFloors.get(areaId) || new Set();
            existing.add(floorId);
            areaToFloors.set(areaId, existing);
          });
      })
    );
  } catch (err) {
    console.warn("[Import] failed to load floor metadata", err);
  }

  if (defaultFloorId) {
    floorSet.add(defaultFloorId);
  }

  const singleFloorId = floorSet.size === 1 ? floorSet.values().next().value : "";

  const ambiguousAreas = new Set();
  const unresolvedAreas = new Set();
  const missingIndexes = new Set();

  const resolved = normalizedRows.map((row, idx) => {
    const areaRaw = String(row.areaId || "").trim();
    if (!areaRaw) {
      const floorId = singleFloorId || "";
      const hasResolvedFloor = Boolean(floorId || !floorSet.size);
      if (!hasResolvedFloor) {
        missingIndexes.add(idx);
      }
      return { ...row, areaId: "", floorId };
    }

    let areaId = areaRaw;
    let floorId = "";
    let hasResolvedFloor = false;

    const floorsForExact = areaToFloors.get(areaRaw);
    if (floorsForExact) {
      if (floorsForExact.size === 1) {
        floorId = floorsForExact.values().next().value;
        hasResolvedFloor = true;
      } else if (floorsForExact.size > 1) {
        ambiguousAreas.add(areaRaw);
      }
    }

    if (!floorId) {
      const parsed = parseFloorPrefixedArea(areaRaw, floorSet);
      if (parsed) {
        areaId = parsed.areaId || areaId;
        floorId = parsed.floorId || floorId;
        if (parsed.floorId) {
          hasResolvedFloor = true;
        }
      }
    }

    if (areaId !== areaRaw) {
      const floorsForParsed = areaToFloors.get(areaId);
      if (floorsForParsed) {
        if (floorsForParsed.size === 1) {
          floorId = floorsForParsed.values().next().value;
          hasResolvedFloor = true;
        } else if (floorId && floorsForParsed.has(floorId)) {
          // ok
        } else if (floorsForParsed.size > 1) {
          ambiguousAreas.add(areaId);
          floorId = "";
          hasResolvedFloor = false;
        }
      }
    } else if (floorId) {
      const floorsForArea = areaToFloors.get(areaId);
      if (floorsForArea && !floorsForArea.has(floorId)) {
        if (floorsForArea.size === 1) {
          floorId = floorsForArea.values().next().value;
          hasResolvedFloor = true;
        } else if (floorsForArea.size > 1) {
          ambiguousAreas.add(areaId);
          floorId = "";
          hasResolvedFloor = false;
        }
      }
    }

    if (!hasResolvedFloor && singleFloorId) {
      floorId = singleFloorId;
      hasResolvedFloor = true;
    }

    if (!hasResolvedFloor && areaId && !ambiguousAreas.has(areaId)) {
      unresolvedAreas.add(areaId);
    }

    if (!hasResolvedFloor && areaId) {
      missingIndexes.add(idx);
    }

    return { ...row, areaId, floorId: floorId || "" };
  });

  return {
    rows: resolved,
    ambiguous: Array.from(ambiguousAreas),
    unresolved: Array.from(unresolvedAreas),
    knownFloors: Array.from(floorSet),
    missingIndexes: Array.from(missingIndexes)
  };
}

export function renderImport(mount) {
  const box = document.createElement("div");
  box.className = "panel";
  box.innerHTML = `
    <h2>スプレッドシート取り込み</h2>
    <div class="form grid twocol">
      <label>シートID<input id="sheetId" placeholder="1abc..."/></label>
      <label>シート名（日付）<input id="dateStr" placeholder="2025-11-04"/></label>
      <label>ID列（A等）<input id="idCol" placeholder="A"/></label>
      <label>基準セル<input id="referenceCell" placeholder="A1"/></label>
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
  box.querySelector("#referenceCell").value = state.referenceCell || "A1";

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
    const referenceCell = (box.querySelector("#referenceCell").value || "A1")
      .trim()
      .toUpperCase();

    console.info("[Import] parameters", {
      sheetId: sheetId.slice(0, 6) + (sheetId.length > 6 ? "…" : ""),
      dateStr,
      col,
      referenceCell
    });

    if (!sheetId || !dateStr || !referenceCell) {
      console.warn("[Import] missing required fields", { sheetId, dateStr, referenceCell });
      toast("シートIDとシート名（日付）、基準セルを入力してください");
      console.groupEnd();
      return;
    }

    setLoading(true);

    try {
      console.info("[Import] ensuring sheet exists");
      await ensureSheetExists({ sheetId, dateStr, referenceCell });
      console.info("[Import] sheet verified");
    } catch (err) {
      console.error("[Import] ensureSheetExists failed", err);
      let message;
      if (err?.code === "SHEET_NOT_FOUND") {
        message = `シート「${dateStr}」が見つかりません。日付を確認してください。`;
      } else if (err?.code === "SHEET_NAME_MISMATCH") {
        const actual = err?.actual ? `（シート内の値: ${err.actual}）` : "";
        const refCell = err?.referenceCell || referenceCell;
        message = `シート名（日付）の指定とシート内${refCell}セルの値が一致しません${actual}。`;
      } else if (err?.code === "SHEET_ACCESS_DENIED") {
        message =
          "シートへのアクセスが拒否されました。共有設定や閲覧権限を確認してください。";
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
      const { ids, rows: rawRows, duplicates } = await readWorkerRows(
        {
          sheetId,
          dateStr,
          idCol: col,
          referenceCell
        },
        { skipEnsure: true }
      );

      console.info("[Import] rows fetched", {
        idCount: ids.length,
        rowCount: rawRows.length,
        duplicates
      });

      if (duplicates.length) {
        const message = `取り込み対象に重複したIDがあります：${duplicates.join(", ")}`;
        console.warn("[Import] duplicate worker IDs detected", duplicates);
        toast(message, "error");
        result.textContent = message;
        setLoading(false);
        console.groupEnd();
        return;
      }

      if (!rawRows.length) {
        console.warn("[Import] no workers found");
        toast("シートに作業者が見つかりませんでした", "error");
        setLoading(false);
        console.groupEnd();
        return;
      }

      const {
        rows: resolvedRows,
        ambiguous,
        unresolved,
        knownFloors,
        missingIndexes
      } =
        await resolveRowsWithFloors(rawRows, {
          userId: state.site.userId,
          siteId: state.site.siteId,
          defaultFloorId: state.site.floorId || ""
        });

      console.info("[Import] floor mapping", {
        knownFloors: knownFloors.length,
        ambiguousAreas: ambiguous,
        unresolvedAreas: unresolved
      });

      const rows = resolvedRows;
      const defaultFloorId = state.site.floorId || "";
      const missingIndexSet = new Set(missingIndexes || []);
      const rowsNeedingFloor = rows.filter(
        (r, idx) => r.areaId && missingIndexSet.has(idx)
      );

      // 既存作業者の取得（重複IDはマスタ更新しない）
      const existingWorkers = await getWorkersOnce({
        userId: state.site.userId,
        siteId: state.site.siteId
      });
      const existingWorkerIds = new Set(
        existingWorkers.map((w) => w.workerId || w.id).filter(Boolean)
      );

      // マスタUpsert
      let newOrUpdated = 0;
      let skippedExisting = 0;
      console.info("[Import] upserting workers", rows.length, {
        existing: existingWorkerIds.size
      });
      for (const r of rows) {
        if (existingWorkerIds.has(r.workerId)) {
          skippedExisting++;
          continue;
        }
        await upsertWorker({
          userId: state.site.userId,
          siteId: state.site.siteId,
          workerId: r.workerId,
          name: r.name,
          active: true,
          defaultStartTime: r.defaultStartTime || DEFAULT_START,
          defaultEndTime: r.defaultEndTime || DEFAULT_END
        });
        existingWorkerIds.add(r.workerId);
        newOrUpdated++;
      }

      // 自動IN：基本エリアが入っている人のみ（同一サイト内で在籍中判定）
      const activeNow = await getActiveAssignments({
        userId: state.site.userId,
        siteId: state.site.siteId
      });
      const assignedSet = new Set(activeNow.map((a) => a.workerId));
      const toAssign = rows.filter(
        (r, idx) => r.areaId && !assignedSet.has(r.workerId) && !missingIndexSet.has(idx)
      );

      console.info("[Import] auto-assign candidates", {
        activeAssignments: activeNow.length,
        candidates: toAssign.length,
        skipped: rowsNeedingFloor.length
      });

      let autoAssignFailures = 0;
      for (const r of toAssign) {
        try {
          await createAssignment({
            userId: state.site.userId,
            siteId: state.site.siteId,
            floorId: r.floorId || defaultFloorId,
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

      if (rowsNeedingFloor.length > 0) {
        toast(`フロアが判別できないため${rowsNeedingFloor.length}名は自動配置されませんでした。`, "info");
      }

      const rosterGroups = new Map();
      for (const r of rows) {
        const floorKey = r.floorId || defaultFloorId;
        const list = rosterGroups.get(floorKey) || [];
        list.push(r);
        rosterGroups.set(floorKey, list);
      }

      for (const [floorId, list] of rosterGroups.entries()) {
        try {
          await saveDailyRoster({
            userId: state.site.userId,
            siteId: state.site.siteId,
            floorId,
            date: dateStr,
            workers: list
          });
        } catch (err) {
          console.error("[Import] saveDailyRoster failed", { floorId, err });
          toast("日次の作業者リストの保存に失敗しました", "error");
        }
      }

      // ストア更新（workersを丸ごと保存してDashboard初期描画にも反映）
      set({
        sheetId,
        dateTab: dateStr,
        idColumn: col,
        referenceCell,
        workers: rows
      });

      const autoInCount = toAssign.length;
      const skippedAuto = rowsNeedingFloor.length;
      const summary = `取り込み成功：${ids.length}名（upsert:${newOrUpdated}件${
        skippedExisting ? `／既存スキップ:${skippedExisting}件` : ""
      }／自動配置:${autoInCount}件${
        skippedAuto ? `／未自動配置:${skippedAuto}件` : ""
      }）`;
      result.textContent = summary;
      toast(summary);
    } catch (err) {
      console.error("[Import] unexpected failure", err);
      const message =
        err?.code === "INVALID_CELL_REFERENCE"
          ? "基準セルの指定が正しくありません。A1のような形式で入力してください。"
          : err?.code === "SHEET_NOT_FOUND"
          ? `シート「${dateStr}」が見つかりません。日付を確認してください。`
          : err?.code === "SHEET_ACCESS_DENIED"
            ? "シートへのアクセスが拒否されました。共有設定や閲覧権限を確認してください。"
          : "取り込みに失敗しました。設定をご確認ください。";
      toast(message, "error");
      result.textContent = message;
    } finally {
      setLoading(false);
      console.groupEnd();
    }
  });
}
