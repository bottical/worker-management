import { state, set } from "../core/store.js";
import {
  subscribeAreas,
  saveAreas,
  subscribeFloors,
  saveFloors,
  DEFAULT_AREAS,
  DEFAULT_FLOORS
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
      </div>
      <div class="hint" id="currentFloorHint" style="margin-top:4px"></div>
      <form id="areaForm" class="form" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-top:16px">
        <label>エリアID（例: A）<input name="areaId" required maxlength="20" /></label>
        <label>表示名（例: エリアA）<input name="label" required maxlength="40" /></label>
        <div class="form-actions" style="grid-column:1/-1">
          <button class="button" type="submit">追加 / 更新</button>
          <button class="button ghost" type="button" id="clearForm">クリア</button>
        </div>
      </form>
      <table class="table" style="margin-top:16px">
        <thead>
          <tr><th>#</th><th>ID</th><th>表示名</th><th>操作</th></tr>
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

  let floors = DEFAULT_FLOORS.slice();
  let areas = DEFAULT_AREAS.slice();
  let currentFloorId =
    state.site.floorId || floors[0]?.id || DEFAULT_FLOORS[0]?.id || "";
  let unsubFloors = () => {};
  let unsubAreas = () => {};

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
    floorSelect.disabled = list.length <= 1;
    if (!list.some((f) => f.id === currentFloorId)) {
      currentFloorId = list[0].id;
      set({ site: { ...state.site, floorId: currentFloorId } });
    }
    floorSelect.value = currentFloorId;
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

  function renderAreaRows() {
    areaRowsEl.innerHTML = "";
    if (!areas.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="4" class="hint">エリアが登録されていません。追加してください。</td>`;
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

  function subscribeAreasForFloor() {
    try {
      unsubAreas();
    } catch {}
    if (!currentFloorId) {
      areas = [];
      renderAreaRows();
      updateFloorHint();
      return;
    }
    unsubAreas = subscribeAreas(
      {
        userId: state.site.userId,
        siteId: state.site.siteId,
        floorId: currentFloorId
      },
      (list) => {
        areas = (list || DEFAULT_AREAS)
          .map((a, idx) => ({
            id: a.id || `Z${idx + 1}`,
            label: a.label || `エリア${idx + 1}`,
            order: typeof a.order === "number" ? a.order : idx
          }))
          .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        renderAreaRows();
      }
    );
    updateFloorHint();
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
    subscribeAreasForFloor();
  }

  async function persistFloors(nextFloors, message) {
    const sanitized = nextFloors
      .map((f) => ({
        id: (f.id || "").trim(),
        label: (f.label || "").trim()
      }))
      .filter((f) => f.id);
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
    areas = nextAreas.map((a, idx) => ({
      id: (a.id || "").trim(),
      label: (a.label || "").trim() || `エリア${idx + 1}`,
      order: idx
    }));
    renderAreaRows();
    try {
      await saveAreas({
        userId: state.site.userId,
        siteId: state.site.siteId,
        floorId: currentFloorId,
        areas
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
    if (!areaId || !label) {
      toast("エリアIDと表示名を入力してください", "error");
      return;
    }
    const next = areas.slice();
    const index = next.findIndex((a) => a.id === areaId);
    if (index >= 0) {
      next[index] = { ...next[index], label };
    } else {
      next.push({ id: areaId, label });
    }
    await persistAreas(next, index >= 0 ? "エリアを更新しました" : "エリアを追加しました");
    areaForm.reset();
  });

  clearAreaBtn?.addEventListener("click", () => {
    areaForm.reset();
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
    floors = (list || DEFAULT_FLOORS)
      .map((f, idx) => ({
        id: f.id || f.floorId || `F${idx + 1}`,
        label: f.label || f.name || f.id || `F${idx + 1}`,
        order: typeof f.order === "number" ? f.order : idx
      }))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
  });

  subscribeAreasForFloor();
  renderFloorRows();
  renderFloorSelect();
  updateFloorHint();
  renderAreaRows();

  window.addEventListener(
    "hashchange",
    () => {
      try {
        unsubFloors();
      } catch {}
      try {
        unsubAreas();
      } catch {}
    },
    { once: true }
  );
}
