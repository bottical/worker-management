import { state, set } from "../core/store.js";
import {
  subscribeAreas,
  saveAreas,
  subscribeFloors,
  saveFloors,
  getAreasOnce,
  DEFAULT_AREAS,
  DEFAULT_FLOORS,
  DEFAULT_SKILL_SETTINGS,
  subscribeSkillSettings
} from "../api/firebase.js";
import { toast } from "../core/ui.js";

export function renderAreas(mount) {
  const wrap = document.createElement("div");
  wrap.className = "panel";
  wrap.innerHTML = `
    <h2>フロア／エリア管理</h2>
    <div class="hint">サイト: ${state.site.siteId}</div>
    <section class="panel-sub" id="floorSection">
      <h3>フロア設定</h3>
      <form id="floorForm" class="form" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:16px">
        <label>フロアID（例: 1F）<input name="floorId" required maxlength="40" /></label>
        <label>表示名（例: 1階）<input name="floorLabel" required maxlength="40" /></label>
        <div class="form-actions" style="grid-column:1/-1">
          <button class="button" type="submit">追加 / 更新</button>
          <button class="button ghost" type="button" id="clearFloor">クリア</button>
        </div>
      </form>
      <table class="table" style="margin-top:16px">
        <thead>
          <tr><th>#</th><th>ID</th><th>表示名</th><th>操作</th></tr>
        </thead>
        <tbody id="floorRows"></tbody>
      </table>
    </section>
    <section class="panel-sub" id="areaSection" style="margin-top:24px">
      <h3>エリア設定</h3>
      <div class="form" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:8px">
        <label>対象フロア<select id="floorSelect"></select></label>
        <label>表示列数（このフロア全体）<input name="columnCount" id="columnCount" type="number" min="1" max="12" placeholder="自動" /></label>
      </div>
      <div class="hint" id="currentFloorHint" style="margin-top:4px"></div>
      <div class="form-actions" style="margin-top:8px">
        <div class="hint">空欄のまま保存すると従来通り自動で列幅を決定します。</div>
        <button class="button ghost" type="button" id="saveLayout">配置設定のみ保存</button>
      </div>
      <form id="areaForm" class="form" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:16px">
        <label>エリアID（例: A）<input name="areaId" required maxlength="20" /></label>
        <label>表示名（例: エリアA）<input name="label" required maxlength="40" /></label>
        <label>列数（1=縦1列）<input name="columns" type="number" min="1" max="8" placeholder="2" /></label>
        <label>カード最小幅（px）<input name="minWidth" type="number" min="80" placeholder="120" /></label>
        <label>列番号（1〜、未入力で自動）<input name="gridColumn" type="number" min="1" max="12" /></label>
        <label>行番号（1〜、未入力で自動）<input name="gridRow" type="number" min="1" max="12" /></label>
        <label>横幅（列数）<input name="colSpan" type="number" min="1" max="12" placeholder="1" /></label>
        <label>縦幅（行数）<input name="rowSpan" type="number" min="1" max="12" placeholder="1" /></label>
        <label style="grid-column:1/-1;display:flex;align-items:center;gap:8px">
          <input type="checkbox" name="countingEnabled" id="countingEnabled" />
          就業カウントを有効化
        </label>
        <label style="grid-column:1/-1">
          対象スキル（複数選択）
          <select name="countingSkillIds" id="countingSkillIds" multiple size="4" style="width:100%"></select>
        </label>
        <label>閾値（分）
          <input name="countingThresholdMinutes" id="countingThresholdMinutes" type="number" min="1" placeholder="120" />
        </label>
        <div class="form-actions" style="grid-column:1/-1">
          <button class="button" type="submit">追加 / 更新</button>
          <button class="button ghost" type="button" id="clearForm">クリア</button>
        </div>
      </form>
      <table class="table" style="margin-top:16px">
        <thead>
          <tr><th>#</th><th>ID</th><th>表示名</th><th>列数</th><th>配置</th><th>対象スキル</th><th>操作</th></tr>
        </thead>
        <tbody id="areaRows"></tbody>
      </table>
    </section>
  `;
  mount.appendChild(wrap);

  if (!state.site?.userId || !state.site?.siteId) {
    const hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "ログインし、サイトを選択してください。";
    wrap.appendChild(hint);
    return;
  }

  const floorForm = wrap.querySelector("#floorForm");
  const clearFloorBtn = wrap.querySelector("#clearFloor");
  const floorRowsEl = wrap.querySelector("#floorRows");
  const floorSelect = wrap.querySelector("#floorSelect");
  const floorHint = wrap.querySelector("#currentFloorHint");

  const areaForm = wrap.querySelector("#areaForm");
  const clearAreaBtn = wrap.querySelector("#clearForm");
  const areaRowsEl = wrap.querySelector("#areaRows");
  const columnCountInput = wrap.querySelector("#columnCount");
  const saveLayoutBtn = wrap.querySelector("#saveLayout");
  const countingEnabledInput = wrap.querySelector("#countingEnabled");
  const countingSkillSelect = wrap.querySelector("#countingSkillIds");
  const countingThresholdInput = wrap.querySelector("#countingThresholdMinutes");

  let floors = DEFAULT_FLOORS.slice();
  let floorsLoaded = false;
  let areas = DEFAULT_AREAS.slice();
  let layoutConfig = { columns: 0 };
  let currentFloorId =
    state.site.floorId || floors[0]?.id || DEFAULT_FLOORS[0]?.id || "";
  let unsubFloors = () => {};
  let unsubAreas = () => {};
  let unsubSkillSettings = () => {};
  const areaCache = new Map();
  const layoutCache = new Map();
  let skillSettings = { ...DEFAULT_SKILL_SETTINGS };

  function toPositiveInt(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.floor(num) : null;
  }

  function normalizeLayoutConfig(layout = {}) {
    const columns = toPositiveInt(layout.columns);
    return { columns: columns && columns > 0 && columns <= 12 ? columns : 0 };
  }

  function normalizeAreaPayload(payload) {
    if (Array.isArray(payload)) {
      return { areas: payload, layout: { columns: 0 } };
    }
    return {
      areas: Array.isArray(payload?.areas) ? payload.areas : [],
      layout: normalizeLayoutConfig(payload?.layout || {})
    };
  }

  function currentFloor() {
    return floors.find((f) => f.id === currentFloorId) || null;
  }

  function updateFloorHint() {
    if (!floorHint) return;
    const info = currentFloor();
    if (!info) {
      floorHint.textContent = "対象フロア: 未選択";
    } else {
      floorHint.textContent = `対象フロア: ${info.label}（ID: ${info.id}）`;
    }
  }

  function renderLayoutInputs() {
    if (!columnCountInput) return;
    columnCountInput.value = layoutConfig.columns || "";
  }

  function setCountingFieldState(enabled) {
    if (countingSkillSelect) {
      countingSkillSelect.disabled = !enabled;
    }
    if (countingThresholdInput) {
      countingThresholdInput.disabled = !enabled;
    }
  }

  function renderCountingSkillOptions(selectedIds = []) {
    if (!countingSkillSelect) return;
    const normalizedSelected = new Set(
      (selectedIds || []).map((id) => String(id || "").trim()).filter(Boolean)
    );
    countingSkillSelect.innerHTML = "";
    const skills = skillSettings?.skills?.length
      ? skillSettings.skills
      : DEFAULT_SKILL_SETTINGS.skills;
    skills.forEach((skill) => {
      const opt = document.createElement("option");
      opt.value = skill.id;
      opt.textContent = skill.name || skill.id;
      if (normalizedSelected.has(skill.id)) {
        opt.selected = true;
      }
      countingSkillSelect.appendChild(opt);
    });
  }

  function getSelectedSkillIds() {
    return Array.from(countingSkillSelect?.selectedOptions || [])
      .map((opt) => opt.value)
      .filter(Boolean);
  }

  function resetCountingForm() {
    if (countingEnabledInput) {
      countingEnabledInput.checked = false;
    }
    if (countingThresholdInput) {
      countingThresholdInput.value = "120";
    }
    renderCountingSkillOptions([]);
    setCountingFieldState(false);
  }

  function readLayoutFromInput() {
    const columns = toPositiveInt(columnCountInput?.value);
    return { columns: columns && columns > 0 ? columns : 0 };
  }

  function renderFloorSelect() {
    if (!floorSelect) return;
    const list = floors.length ? floors : DEFAULT_FLOORS;
    floorSelect.innerHTML = "";
    if (!list.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "フロア未登録";
      opt.disabled = true;
      opt.selected = true;
      floorSelect.appendChild(opt);
      floorSelect.disabled = true;
      return;
    }
    list.forEach((floor) => {
      const opt = document.createElement("option");
      opt.value = floor.id;
      opt.textContent = floor.label;
      floorSelect.appendChild(opt);
    });
    floorSelect.disabled = list.length === 0;
    const hasCurrent = list.some((f) => f.id === currentFloorId);
    const fallbackId = list[0]?.id || "";
    floorSelect.value = hasCurrent ? currentFloorId : fallbackId;
    if (!hasCurrent && floorsLoaded && fallbackId) {
      currentFloorId = fallbackId;
      set({ site: { ...state.site, floorId: currentFloorId } });
    }
  }

  function renderFloorRows() {
    floorRowsEl.innerHTML = "";
    if (!floors.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="4" class="hint">フロアが登録されていません。追加してください。</td>`;
      floorRowsEl.appendChild(tr);
      return;
    }
    floors.forEach((floor, index) => {
      const tr = document.createElement("tr");
      const upDisabled = index === 0 ? "disabled" : "";
      const downDisabled = index === floors.length - 1 ? "disabled" : "";
      tr.innerHTML = `
        <td class="mono">${index + 1}</td>
        <td class="mono">${floor.id}</td>
        <td>${floor.label}</td>
        <td class="row-actions">
          <button type="button" class="button ghost" data-floor-edit="${floor.id}">編集</button>
          <button type="button" class="button ghost" data-floor-up="${floor.id}" ${upDisabled}>↑</button>
          <button type="button" class="button ghost" data-floor-down="${floor.id}" ${downDisabled}>↓</button>
          <button type="button" class="button" data-floor-delete="${floor.id}" style="background:#dc2626">削除</button>
        </td>
      `;
      floorRowsEl.appendChild(tr);
    });

    floorRowsEl.querySelectorAll("button[data-floor-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = floors.find((f) => f.id === btn.dataset.floorEdit);
        if (!target) return;
        floorForm.floorId.value = target.id;
        floorForm.floorLabel.value = target.label;
        floorForm.floorId.focus();
      });
    });

    floorRowsEl.querySelectorAll("button[data-floor-up]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = floors.findIndex((f) => f.id === btn.dataset.floorUp);
        if (idx > 0) {
          const next = floors.slice();
          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
          await persistFloors(next, "フロアの順序を更新しました");
        }
      });
    });

    floorRowsEl.querySelectorAll("button[data-floor-down]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = floors.findIndex((f) => f.id === btn.dataset.floorDown);
        if (idx >= 0 && idx < floors.length - 1) {
          const next = floors.slice();
          [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
          await persistFloors(next, "フロアの順序を更新しました");
        }
      });
    });

    floorRowsEl.querySelectorAll("button[data-floor-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.floorDelete;
        if (!confirm(`フロア「${id}」を削除しますか？`)) return;
        const next = floors.filter((f) => f.id !== id);
        await persistFloors(next, "フロアを削除しました");
      });
    });
  }

  function formatPlacement(area) {
    if (!area) return "自動";
    const col = area.gridColumn ? `列${area.gridColumn}` : "列: 自動";
    const row = area.gridRow ? `行${area.gridRow}` : "行: 自動";
    const span = [];
    if (area.colSpan && area.colSpan > 1) span.push(`横${area.colSpan}`);
    if (area.rowSpan && area.rowSpan > 1) span.push(`縦${area.rowSpan}`);
    const spanText = span.length ? `（${span.join("・")}）` : "";
    return `${col} / ${row}${spanText}`;
  }

  function getSkillNameMap() {
    const skills = skillSettings?.skills?.length
      ? skillSettings.skills
      : DEFAULT_SKILL_SETTINGS.skills;
    return new Map(
      skills
        .map((skill) => ({
          id: String(skill?.id || "").trim(),
          name: skill?.name || skill?.id
        }))
        .filter((skill) => skill.id)
        .map((skill) => [skill.id, skill.name])
    );
  }

  function getCountingSkillLabel(area) {
    if (!area?.counting?.enabled) return "-";
    const skillIds = Array.isArray(area.counting.skillIds)
      ? area.counting.skillIds
      : [];
    if (!skillIds.length) return "-";
    const map = getSkillNameMap();
    const names = skillIds
      .map((id) => map.get(String(id)) || String(id))
      .filter(Boolean);
    return names.length ? names.join(", ") : "-";
  }

  function renderAreaRows() {
    areaRowsEl.innerHTML = "";
    if (!areas.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="7" class="hint">エリアが登録されていません。追加してください。</td>`;
      areaRowsEl.appendChild(tr);
      return;
    }
    areas.forEach((area, index) => {
      const tr = document.createElement("tr");
      const upDisabled = index === 0 ? "disabled" : "";
      const downDisabled = index === areas.length - 1 ? "disabled" : "";
      tr.innerHTML = `
        <td class="mono">${index + 1}</td>
        <td class="mono">${area.id}</td>
        <td>${area.label}</td>
        <td class="mono">${area.columns || "自動"}</td>
        <td class="mono">${formatPlacement(area)}</td>
        <td>${getCountingSkillLabel(area)}</td>
        <td class="row-actions">
          <button type="button" class="button ghost" data-edit="${area.id}">編集</button>
          <button type="button" class="button ghost" data-up="${area.id}" ${upDisabled}>↑</button>
          <button type="button" class="button ghost" data-down="${area.id}" ${downDisabled}>↓</button>
          <button type="button" class="button" data-delete="${area.id}" style="background:#dc2626">削除</button>
        </td>
      `;
      areaRowsEl.appendChild(tr);
    });

    areaRowsEl.querySelectorAll("button[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = areas.find((a) => a.id === btn.dataset.edit);
        if (!target) return;
        areaForm.areaId.value = target.id;
        areaForm.label.value = target.label;
        areaForm.columns.value = target.columns || "";
        areaForm.minWidth.value = target.minWidth || "";
        areaForm.gridColumn.value = target.gridColumn || "";
        areaForm.gridRow.value = target.gridRow || "";
        areaForm.colSpan.value = target.colSpan || "";
        areaForm.rowSpan.value = target.rowSpan || "";
        if (countingEnabledInput) {
          countingEnabledInput.checked = target.counting?.enabled === true;
        }
        if (countingThresholdInput) {
          countingThresholdInput.value = target.counting?.thresholdMinutes || 120;
        }
        renderCountingSkillOptions(target.counting?.skillIds || []);
        setCountingFieldState(countingEnabledInput?.checked);
        areaForm.areaId.focus();
      });
    });

    areaRowsEl.querySelectorAll("button[data-up]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = areas.findIndex((a) => a.id === btn.dataset.up);
        if (idx > 0) {
          const next = areas.slice();
          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
          await persistAreas(next, "エリアの順序を更新しました");
        }
      });
    });

    areaRowsEl.querySelectorAll("button[data-down]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = areas.findIndex((a) => a.id === btn.dataset.down);
        if (idx >= 0 && idx < areas.length - 1) {
          const next = areas.slice();
          [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
          await persistAreas(next, "エリアの順序を更新しました");
        }
      });
    });

    areaRowsEl.querySelectorAll("button[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.delete;
        if (!confirm(`エリア「${id}」を削除しますか？`)) return;
        const next = areas.filter((a) => a.id !== id);
        await persistAreas(next, "エリアを削除しました");
      });
    });
  }

  async function loadAreasForFloor(floorId) {
    if (!floorId || areaCache.has(floorId)) {
      const payload = areaCache.get(floorId);
      if (payload) return payload;
      return { areas: [], layout: { columns: 0 } };
    }
    try {
      const payload = await getAreasOnce({
        userId: state.site.userId,
        siteId: state.site.siteId,
        floorId
      });
      const normalized = normalizeAreaPayload(payload);
      const sortedAreas = (normalized.areas || DEFAULT_AREAS)
        .map((a, idx) => ({
          id: a.id || `Z${idx + 1}`,
          label: a.label || `エリア${idx + 1}`,
          order: typeof a.order === "number" ? a.order : idx,
          columns: toPositiveInt(a.columns),
          minWidth: toPositiveInt(a.minWidth),
          gridColumn: a.gridColumn,
          gridRow: a.gridRow,
          colSpan: a.colSpan,
          rowSpan: a.rowSpan,
          counting: a.counting
        }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const payloadForCache = {
        areas: sortedAreas.map((a, idx) => ({ ...a, order: idx })),
        layout: normalized.layout
      };
      areaCache.set(floorId, payloadForCache);
      layoutCache.set(floorId, payloadForCache.layout);
      return payloadForCache;
    } catch (err) {
      console.error("loadAreasForFloor failed", err);
      return { areas: [], layout: { columns: 0 } };
    }
  }

  async function findAreaIdConflict(areaId) {
    const targetId = (areaId || "").trim();
    if (!targetId) return null;
    for (const floor of floors) {
      if (!floor?.id || floor.id === currentFloorId) continue;
      const payload = await loadAreasForFloor(floor.id);
      if ((payload.areas || []).some((a) => a.id === targetId)) {
        return floor;
      }
    }
    return null;
  }

  function subscribeAreasForFloor() {
    try {
      unsubAreas();
    } catch (err) {
      console.warn("unsubAreas failed", err);
    }
    areas = [];
    layoutConfig = normalizeLayoutConfig(layoutCache.get(currentFloorId) || {});
    renderAreaRows();
    renderLayoutInputs();
    updateFloorHint();
    if (!currentFloorId) {
      return;
    }
    unsubAreas = subscribeAreas(
      {
        userId: state.site.userId,
        siteId: state.site.siteId,
        floorId: currentFloorId
      },
      (payload) => {
        const { areas: fetchedAreas, layout } = normalizeAreaPayload(payload);
        areas = (fetchedAreas || DEFAULT_AREAS)
          .map((a, idx) => ({
            id: a.id || `Z${idx + 1}`,
            label: a.label || `エリア${idx + 1}`,
            order: typeof a.order === "number" ? a.order : idx,
            columns: toPositiveInt(a.columns),
            minWidth: toPositiveInt(a.minWidth),
            gridColumn: a.gridColumn,
            gridRow: a.gridRow,
            colSpan: a.colSpan,
            rowSpan: a.rowSpan,
            counting: a.counting
          }))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
          .map((a, idx) => ({ ...a, order: idx }));
        layoutConfig = normalizeLayoutConfig(layout);
        areaCache.set(currentFloorId, { areas: areas.slice(), layout: layoutConfig });
        layoutCache.set(currentFloorId, layoutConfig);
        renderLayoutInputs();
        renderAreaRows();
      }
    );
  }

  function switchFloor(nextFloorId) {
    if (!nextFloorId) return;
    if (nextFloorId === currentFloorId) {
      renderFloorSelect();
      updateFloorHint();
      return;
    }
    currentFloorId = nextFloorId;
    set({ site: { ...state.site, floorId: currentFloorId } });
    renderFloorSelect();
    updateFloorHint();
    areaForm?.reset();
    const cached = areaCache.get(currentFloorId);
    if (cached) {
      areas = (cached.areas || []).slice();
      layoutConfig = normalizeLayoutConfig(cached.layout || {});
      renderLayoutInputs();
      renderAreaRows();
    }
    subscribeAreasForFloor();
  }

  async function persistFloors(nextFloors, message) {
    const sanitized = nextFloors
      .map((f) => ({
        id: (f.id || "").trim(),
        label: (f.label || "").trim()
      }))
      .filter((f) => f.id);
    floorsLoaded = true;
    floors = sanitized.length
      ? sanitized.map((f, idx) => ({
          id: f.id,
          label: f.label || `フロア${idx + 1}`,
          order: idx
        }))
      : DEFAULT_FLOORS.slice();
    renderFloorRows();
    renderFloorSelect();
    updateFloorHint();
    try {
      floors = await saveFloors({
        userId: state.site.userId,
        siteId: state.site.siteId,
        siteLabel: state.site.siteId,
        floors
      });
      toast(message || "フロアを保存しました");
    } catch (err) {
      console.error("saveFloors failed", err);
      toast("フロアの保存に失敗しました", "error");
    }
    if (!floors.some((f) => f.id === currentFloorId)) {
      const fallback = floors[0];
      currentFloorId = fallback ? fallback.id : "";
      set({ site: { ...state.site, floorId: currentFloorId } });
    }
    renderFloorSelect();
    subscribeAreasForFloor();
  }

  async function persistAreas(nextAreas, message) {
    if (!currentFloorId) {
      toast("フロアを選択してください", "error");
      return;
    }
    layoutConfig = readLayoutFromInput();
    areas = nextAreas.map((a, idx) => ({
      id: (a.id || "").trim(),
      label: (a.label || "").trim() || `エリア${idx + 1}`,
      order: idx,
      columns: toPositiveInt(a.columns),
      minWidth: toPositiveInt(a.minWidth),
      gridColumn: toPositiveInt(a.gridColumn),
      gridRow: toPositiveInt(a.gridRow),
      colSpan: toPositiveInt(a.colSpan),
      rowSpan: toPositiveInt(a.rowSpan),
      counting: a.counting
    }));
    areaCache.set(currentFloorId, { areas: areas.slice(), layout: layoutConfig });
    layoutCache.set(currentFloorId, layoutConfig);
    renderLayoutInputs();
    renderAreaRows();
    try {
      await saveAreas({
        userId: state.site.userId,
        siteId: state.site.siteId,
        floorId: currentFloorId,
        areas,
        layout: layoutConfig
      });
      toast(message || "エリアを保存しました");
    } catch (err) {
      console.error("saveAreas failed", err);
      toast("エリアの保存に失敗しました", "error");
    }
  }

  floorForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(floorForm);
    const floorId = (fd.get("floorId") || "").toString().trim();
    const floorLabel = (fd.get("floorLabel") || "").toString().trim();
    if (!floorId || !floorLabel) {
      toast("フロアIDと表示名を入力してください", "error");
      return;
    }
    const next = floors.slice();
    const index = next.findIndex((f) => f.id === floorId);
    if (index >= 0) {
      next[index] = { ...next[index], id: floorId, label: floorLabel };
    } else {
      next.push({ id: floorId, label: floorLabel });
    }
    await persistFloors(next, index >= 0 ? "フロアを更新しました" : "フロアを追加しました");
    floorForm.reset();
  });

  clearFloorBtn?.addEventListener("click", () => {
    floorForm.reset();
  });

  areaForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(areaForm);
    const areaId = (fd.get("areaId") || "").toString().trim();
    const label = (fd.get("label") || "").toString().trim();
    const columns = toPositiveInt(fd.get("columns"));
    const minWidth = toPositiveInt(fd.get("minWidth"));
    const gridColumn = toPositiveInt(fd.get("gridColumn"));
    const gridRow = toPositiveInt(fd.get("gridRow"));
    const colSpan = toPositiveInt(fd.get("colSpan"));
    const rowSpan = toPositiveInt(fd.get("rowSpan"));
    const countingEnabled = Boolean(countingEnabledInput?.checked);
    const countingSkillIds = countingEnabled ? getSelectedSkillIds() : [];
    const countingThresholdMinutes =
      toPositiveInt(fd.get("countingThresholdMinutes")) || 120;
    if (!areaId || !label) {
      toast("エリアIDと表示名を入力してください", "error");
      return;
    }
    if (countingEnabled && countingSkillIds.length === 0) {
      toast("対象スキルが未設定です");
    }
    const next = areas.slice();
    const index = next.findIndex((a) => a.id === areaId);
    if (index < 0) {
      const conflict = await findAreaIdConflict(areaId);
      if (conflict) {
        toast(`エリアID「${areaId}」はフロア「${conflict.label}」で使用されています`, "error");
        return;
      }
    }
    if (index >= 0) {
      next[index] = {
        ...next[index],
        label,
        columns,
        minWidth,
        gridColumn,
        gridRow,
        colSpan,
        rowSpan,
        counting: {
          enabled: countingEnabled,
          skillIds: countingSkillIds,
          thresholdMinutes: countingThresholdMinutes
        }
      };
    } else {
      next.push({
        id: areaId,
        label,
        columns,
        minWidth,
        gridColumn,
        gridRow,
        colSpan,
        rowSpan,
        counting: {
          enabled: countingEnabled,
          skillIds: countingSkillIds,
          thresholdMinutes: countingThresholdMinutes
        }
      });
    }
    await persistAreas(next, index >= 0 ? "エリアを更新しました" : "エリアを追加しました");
    areaForm.reset();
    resetCountingForm();
  });

  clearAreaBtn?.addEventListener("click", () => {
    areaForm.reset();
    resetCountingForm();
  });

  saveLayoutBtn?.addEventListener("click", async () => {
    await persistAreas(areas.slice(), "配置設定を更新しました");
  });

  countingEnabledInput?.addEventListener("change", (e) => {
    setCountingFieldState(e.target.checked);
  });

  floorSelect?.addEventListener("change", (e) => {
    switchFloor(e.target.value || "");
  });

  unsubFloors = subscribeFloors(
    {
      userId: state.site.userId,
      siteId: state.site.siteId
    },
    (list) => {
      floorsLoaded = true;
      floors = (list || DEFAULT_FLOORS)
        .map((f, idx) => ({
          id: f.id || f.floorId || `F${idx + 1}`,
          label: f.label || f.name || f.id || `F${idx + 1}`,
          order: typeof f.order === "number" ? f.order : idx
        }))
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      const knownFloorIds = new Set(floors.map((f) => f.id));
      Array.from(areaCache.keys()).forEach((key) => {
        if (!knownFloorIds.has(key)) {
          areaCache.delete(key);
        }
      });
      if (!floors.length) {
        floors = DEFAULT_FLOORS.slice();
      }
      if (!floors.some((f) => f.id === currentFloorId)) {
        currentFloorId = floors[0]?.id || "";
        set({ site: { ...state.site, floorId: currentFloorId } });
      }
      renderFloorRows();
      renderFloorSelect();
      updateFloorHint();
      subscribeAreasForFloor();
    }
  );

  unsubSkillSettings = subscribeSkillSettings(
    {
      userId: state.site.userId,
      siteId: state.site.siteId
    },
    (settings) => {
      skillSettings = settings || { ...DEFAULT_SKILL_SETTINGS };
      renderCountingSkillOptions(getSelectedSkillIds());
      renderAreaRows();
    }
  );

  subscribeAreasForFloor();
  renderFloorRows();
  renderFloorSelect();
  updateFloorHint();
  resetCountingForm();
  renderAreaRows();

  window.addEventListener(
    "hashchange",
    () => {
      try {
        unsubFloors();
      } catch (err) {
        console.warn("unsubFloors failed", err);
      }
      try {
        unsubAreas();
      } catch (err) {
        console.warn("unsubAreas failed", err);
      }
      try {
        unsubSkillSettings();
      } catch (err) {
        console.warn("unsubSkillSettings failed", err);
      }
    },
    { once: true }
  );
}
