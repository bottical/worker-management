// pages/search.html.js
import { state } from "../core/store.js";
import {
  getAssignmentsByDate,
  getWorkerById,
  resolveWorkerId,
  updateAssignmentTimeNotes
} from "../api/firebase.js";
import { toast } from "../core/ui.js";

function todayIso() {
  const dt = new Date();
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const OVERTIME_CANDIDATES = ["18", "19", "20", "20.5", "21", "22", "23"];

function timestampToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  if (typeof ts === "number") return ts;
  if (typeof ts?.seconds === "number") return ts.seconds * 1000;
  return 0;
}

function parseHalfHourValue(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  return Math.round(num * 2) / 2;
}

function formatHalfHour(value) {
  if (!Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function isValidDateString(value) {
  if (!value) return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  const dt = new Date(year, month - 1, day);
  return dt.getFullYear() === year && dt.getMonth() === month - 1 && dt.getDate() === day;
}

function pickLatestAssignment(assignments, workerId) {
  return (assignments || [])
    .filter((row) => row?.workerId === workerId)
    .sort((a, b) => {
      const aStamp = timestampToMillis(a.updatedAt) || timestampToMillis(a.inAt);
      const bStamp = timestampToMillis(b.updatedAt) || timestampToMillis(b.inAt);
      return bStamp - aStamp;
    })[0];
}

function buildOvertimeValueUI({ assignment, container, onSaved }) {
  const currentValue =
    typeof assignment?.timeNoteRight === "string" ? assignment.timeNoteRight.trim() : "";
  container.innerHTML = `
    <div class="search-overtime" aria-live="polite">
      <h4>残業入力（右メモ）</h4>
      <p class="hint">現在値: <strong class="search-overtime-current">${currentValue || "未設定"}</strong></p>
      <div class="search-overtime-grid">
        ${OVERTIME_CANDIDATES.map(
          (value) =>
            `<button type="button" class="button ghost search-overtime-pick" data-value="${value}">${value}</button>`
        ).join("")}
      </div>
      <div class="search-overtime-adjust">
        <button type="button" class="button ghost" data-adjust="-0.5">-0.5</button>
        <button type="button" class="button ghost" data-adjust="0.5">+0.5</button>
        <button type="button" class="button search-overtime-done" data-value="済">済</button>
        <button type="button" class="button ghost" data-clear="true">Clear</button>
      </div>
      <div class="search-overtime-input-row">
        <input type="text" inputmode="decimal" step="0.5" placeholder="値を入力" class="search-overtime-input" />
        <button type="button" class="button search-overtime-save">登録</button>
      </div>
    </div>
  `;

  const currentLabel = container.querySelector(".search-overtime-current");
  const input = container.querySelector(".search-overtime-input");
  const saveBtn = container.querySelector(".search-overtime-save");
  const adjustButtons = Array.from(container.querySelectorAll("[data-adjust]"));

  const setInputValue = (value) => {
    input.value = value;
    currentLabel.textContent = value || "未設定";
    const numeric = parseHalfHourValue(value);
    adjustButtons.forEach((btn) => {
      btn.disabled = numeric === null;
    });
  };

  setInputValue(currentValue);

  container.querySelectorAll("[data-value]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setInputValue(btn.dataset.value || "");
      saveBtn.focus();
    });
  });

  container.querySelectorAll("[data-adjust]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const current = parseHalfHourValue(input.value);
      if (current === null) return;
      const next = current + Number(btn.dataset.adjust || 0);
      setInputValue(formatHalfHour(next));
      saveBtn.focus();
    });
  });

  const clearBtn = container.querySelector("[data-clear='true']");
  clearBtn?.addEventListener("click", () => {
    setInputValue("");
    saveBtn.focus();
  });

  saveBtn.addEventListener("click", async () => {
    if (!assignment?.id) return;
    const payload = input.value.trim();
    saveBtn.disabled = true;
    try {
      await updateAssignmentTimeNotes({
        userId: state.site.userId,
        siteId: state.site.siteId,
        assignmentId: assignment.id,
        timeNoteLeft: typeof assignment.timeNoteLeft === "string" ? assignment.timeNoteLeft : "",
        timeNoteRight: payload
      });
      toast("Saved", "success");
      onSaved?.();
      setInputValue(payload);
    } catch (err) {
      console.error("[Search] overtime save failed", err);
      toast("保存に失敗しました", "error");
    } finally {
      saveBtn.disabled = false;
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveBtn.click();
    }
  });

  const firstCandidate = container.querySelector(".search-overtime-pick");
  (firstCandidate || input)?.focus();
}

export function renderSearch(mount) {
  const box = document.createElement("div");
  box.className = "panel board-scale-exempt";
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

  const focusSearchCode = () => {
    codeInput.value = "";
    requestAnimationFrame(() => {
      codeInput.focus();
      codeInput.select();
    });
  };

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

      const searchDate = dateInput.value.trim();
      const today = todayIso();
      let latestAssignment = null;
      let overtimeMessage = "";

      if (!isValidDateString(searchDate)) {
        overtimeMessage = "日付が不正なため、残業入力はできません。";
      } else if (searchDate !== today) {
        overtimeMessage = "残業入力は当日分のみ対応しています。";
      } else {
        const allAssignments = await getAssignmentsByDate({
          userId: state.site.userId,
          siteId: state.site.siteId,
          date: today
        });
        latestAssignment = pickLatestAssignment(allAssignments, workerId);
        if (!latestAssignment) {
          overtimeMessage = "本日の在籍データが見つからないため、残業入力はできません。";
        }
      }

      const name = worker?.name || workerId;
      const company = worker?.company ? `（${worker.company}）` : "";

      result.innerHTML = `
        <div class="panel" style="margin-top:12px">
          <h3>検索結果</h3>
          <p style="margin-top:8px"><strong>${name}</strong> ${company}</p>
          <p class="hint" style="margin-top:4px">ID: ${workerId}</p>
          <div id="searchOvertimeMount" style="margin-top:12px"></div>
          <div class="form-actions" style="margin-top:12px;gap:8px">
            <a class="button" href="#/users">設定画面へ</a>
            <a class="button ghost" href="#/dashboard">配置画面へ</a>
          </div>
        </div>
      `;

      const overtimeMount = result.querySelector("#searchOvertimeMount");
      if (!overtimeMount) return;
      if (!latestAssignment) {
        overtimeMount.innerHTML = `<div class="search-overtime search-overtime-disabled hint">${overtimeMessage}</div>`;
      } else {
        buildOvertimeValueUI({ assignment: latestAssignment, container: overtimeMount, onSaved: focusSearchCode });
      }
    } catch (err) {
      console.error("[Search] resolve failed", err);
      const message = "検索に失敗しました。入力内容をご確認ください。";
      toast(message, "error");
      result.textContent = message;
    } finally {
      setLoading(false);
    }
  });

  const runSearchByEnter = (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    runBtn.click();
  };

  dateInput.addEventListener("keydown", runSearchByEnter);
  codeInput.addEventListener("keydown", runSearchByEnter);

  codeInput.focus();
}
