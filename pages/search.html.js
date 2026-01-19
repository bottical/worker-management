// pages/search.html.js
import { state } from "../core/store.js";
import { getWorkerById, resolveWorkerId } from "../api/firebase.js";
import { toast } from "../core/ui.js";

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function renderSearch(mount) {
  const box = document.createElement("div");
  box.className = "panel";
  box.innerHTML = `
    <h2>作業者検索</h2>
    <div class="form grid twocol">
      <label>日付<input id="searchDate" type="date" /></label>
      <label>検索コード<input id="searchCode" placeholder="ID または 区別コード" /></label>
    </div>
    <div class="form-actions" style="align-items:center;gap:12px">
      <button id="searchRun" class="button">検索</button>
      <div id="searchProgress" class="loading-indicator" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <span>検索中...</span>
      </div>
    </div>
    <div id="searchResult" class="hint"></div>
  `;
  mount.appendChild(box);

  const dateInput = box.querySelector("#searchDate");
  const codeInput = box.querySelector("#searchCode");
  const runBtn = box.querySelector("#searchRun");
  const progress = box.querySelector("#searchProgress");
  const result = box.querySelector("#searchResult");

  dateInput.value = state.dateTab || todayIso();

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
    if (!state.site?.userId || !state.site?.siteId) {
      toast("ログインし、サイトを選択してください", "error");
      return;
    }
    const date = dateInput.value.trim();
    const code = codeInput.value.trim();

    if (!date || !code) {
      toast("日付と検索コードを入力してください", "error");
      return;
    }

    setLoading(true);

    try {
      const workerId = await resolveWorkerId({
        userId: state.site.userId,
        siteId: state.site.siteId,
        date,
        code
      });

      if (!workerId) {
        const message = "該当する作業者が見つかりませんでした。取込状況をご確認ください。";
        result.textContent = message;
        toast(message, "info");
        return;
      }

      const worker = await getWorkerById({
        userId: state.site.userId,
        siteId: state.site.siteId,
        workerId
      });

      const name = worker?.name || workerId;
      const company = worker?.company ? `（${worker.company}）` : "";

      result.innerHTML = `
        <div class="panel" style="margin-top:12px">
          <h3>検索結果</h3>
          <p style="margin-top:8px"><strong>${name}</strong> ${company}</p>
          <p class="hint" style="margin-top:4px">ID: ${workerId}</p>
          <div class="form-actions" style="margin-top:12px;gap:8px">
            <a class="button" href="#/users">設定画面へ</a>
            <a class="button ghost" href="#/dashboard">配置画面へ</a>
          </div>
        </div>
      `;
    } catch (err) {
      console.error("[Search] resolve failed", err);
      const message = "検索に失敗しました。入力内容をご確認ください。";
      toast(message, "error");
      result.textContent = message;
    } finally {
      setLoading(false);
    }
  });
}
