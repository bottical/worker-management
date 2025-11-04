import { state } from "../core/store.js";
import { subscribeAreas, saveAreas, DEFAULT_AREAS } from "../api/firebase.js";
import { toast } from "../core/ui.js";

export function renderAreas(mount) {
  const wrap = document.createElement("div");
  wrap.className = "panel";
  wrap.innerHTML = `
    <h2>エリア管理</h2>
    <div class="hint">サイト: ${state.site.siteId}／フロア: ${state.site.floorId}</div>
    <div class="hint" style="margin-top:4px">エリアの追加・削除・並び替えができます。IDはドラッグ＆ドロップ時の識別子になります。</div>
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
  `;
  mount.appendChild(wrap);

  const form = wrap.querySelector("#areaForm");
  const clearBtn = wrap.querySelector("#clearForm");
  const rowsEl = wrap.querySelector("#areaRows");

  let areas = DEFAULT_AREAS.slice();
  let unsub = () => {};

  function renderRows() {
    rowsEl.innerHTML = "";
    if (!areas.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="4" class="hint">エリアが登録されていません。追加してください。</td>`;
      rowsEl.appendChild(tr);
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
      rowsEl.appendChild(tr);
    });

    rowsEl.querySelectorAll("button[data-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const target = areas.find((a) => a.id === btn.dataset.edit);
        if (!target) return;
        form.areaId.value = target.id;
        form.label.value = target.label;
        form.areaId.focus();
      });
    });

    rowsEl.querySelectorAll("button[data-up]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = areas.findIndex((a) => a.id === btn.dataset.up);
        if (idx > 0) {
          const next = areas.slice();
          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
          await persist(next, "エリアの順序を更新しました");
        }
      });
    });

    rowsEl.querySelectorAll("button[data-down]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = areas.findIndex((a) => a.id === btn.dataset.down);
        if (idx >= 0 && idx < areas.length - 1) {
          const next = areas.slice();
          [next[idx + 1], next[idx]] = [next[idx], next[idx + 1]];
          await persist(next, "エリアの順序を更新しました");
        }
      });
    });

    rowsEl.querySelectorAll("button[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.delete;
        if (!confirm(`エリア「${id}」を削除しますか？`)) return;
        const next = areas.filter((a) => a.id !== id);
        await persist(next, "エリアを削除しました");
      });
    });
  }

  async function persist(nextAreas, message) {
    areas = nextAreas.map((a, idx) => ({
      id: (a.id || "").trim(),
      label: (a.label || "").trim() || `エリア${idx + 1}`,
      order: idx
    }));
    renderRows();
    try {
      await saveAreas({
        siteId: state.site.siteId,
        floorId: state.site.floorId,
        areas
      });
      toast(message || "エリアを保存しました");
    } catch (err) {
      console.error("saveAreas failed", err);
      toast("エリアの保存に失敗しました", "error");
    }
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
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
    await persist(next, index >= 0 ? "エリアを更新しました" : "エリアを追加しました");
    form.reset();
  });

  clearBtn?.addEventListener("click", () => {
    form.reset();
  });

  unsub = subscribeAreas(state.site, (list) => {
    areas = (list || DEFAULT_AREAS).map((a, idx) => ({
      id: a.id || `Z${idx + 1}`,
      label: a.label || `エリア${idx + 1}`,
      order: typeof a.order === "number" ? a.order : idx
    })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    renderRows();
  });

  window.addEventListener(
    "hashchange",
    () => {
      try {
        unsub();
      } catch {}
    },
    { once: true }
  );

  renderRows();
}
