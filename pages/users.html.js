import { state } from "../core/store.js";
import {
  DEFAULT_SKILL_SETTINGS,
  saveSkillSettings,
  subscribeSkillSettings,
  subscribeWorkers,
  upsertWorker,
  removeWorker
} from "../api/firebase.js";
import { toast } from "../core/ui.js";
import { normalizeHex } from "../core/colors.js";

const DEFAULT_START = "09:00";
const DEFAULT_END = "18:00";
const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50];

function normalizeSkillLevels(levels = {}) {
  if (!levels || typeof levels !== "object") return {};
  const result = {};
  Object.entries(levels).forEach(([key, value]) => {
    if (typeof value === "string" && value.trim()) {
      result[key] = value.trim();
    }
  });
  return result;
}

function normalizeTimeRules(timeRules = {}) {
  if (!timeRules || typeof timeRules !== "object") {
    return { startRules: [], endRules: [] };
  }
  const startRules = Array.isArray(timeRules.startRules) ? timeRules.startRules : [];
  const endRules = Array.isArray(timeRules.endRules) ? timeRules.endRules : [];
  const fallbackStart = timeRules.startHour ? [timeRules.startHour] : [];
  const fallbackEnd = timeRules.endHour ? [timeRules.endHour] : [];
  return {
    startRules: startRules.length ? startRules : fallbackStart,
    endRules: endRules.length ? endRules : fallbackEnd
  };
}

export function renderUsers(mount){
  const wrap = document.createElement("div");
  wrap.className = "panel";
  wrap.innerHTML = `
    <h2>ユーザー管理</h2>
    <div class="hint">作業者マスタの追加・編集・削除ができます。</div>

    <section class="panel-sub" id="skillConfigSection" style="margin-top:12px">
      <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap">
        <div>
          <h3 style="margin:0">スキル設定</h3>
          <div class="hint" style="margin:4px 0 0">スキル名とステータス名を編集できます（4種×3段階）。</div>
        </div>
        <button class="button ghost" type="button" id="toggleSkillConfig">スキル設定を編集</button>
      </div>
      <div id="skillConfigContent" style="display:none;margin-top:12px">
        <form id="skillConfigForm" class="form" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-top:12px">
          <div id="skillNameFields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px"></div>
          <div id="skillLevelFields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px"></div>
          <div id="timeRuleFields" style="grid-column:1/-1;display:grid;gap:12px">
            <div style="font-weight:700">勤務時間ハイライト設定</div>
            <div style="display:grid;gap:8px">
              <div style="font-weight:600">開始時間ルール</div>
              <div id="timeRuleStartList" style="display:grid;gap:6px"></div>
              <button class="button ghost" type="button" id="addStartRule">開始ルールを追加</button>
            </div>
            <div style="display:grid;gap:8px">
              <div style="font-weight:600">終了時間ルール</div>
              <div id="timeRuleEndList" style="display:grid;gap:6px"></div>
              <button class="button ghost" type="button" id="addEndRule">終了ルールを追加</button>
            </div>
          </div>
          <div class="form-actions" style="grid-column:1/-1">
            <button class="button" type="submit">スキル設定を保存</button>
          </div>
        </form>
      </div>
    </section>

    <section class="panel-sub" id="workerFormSection" style="margin-top:12px">
      <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;flex-wrap:wrap">
        <div>
          <h3 style="margin:0">新規登録</h3>
          <div class="hint" style="margin:4px 0 0">作業者の新規登録や基本情報を設定できます。</div>
        </div>
        <button class="button ghost" type="button" id="toggleWorkerForm">新規登録フォームを開く</button>
      </div>
      <div id="workerFormContent" style="display:none;margin-top:12px">
        <form id="form" style="display:grid;grid-template-columns:repeat(4, minmax(180px,1fr));gap:8px;margin:12px 0">
          <label>作業者ID<input name="workerId" required placeholder="ID001"></label>
          <label>氏名<input name="name" placeholder="山田 太郎"></label>
          <label>会社<input name="company" placeholder="THERE"></label>
          <label>開始時間<input name="defaultStartTime" id="defaultStartTime" type="time" placeholder="09:00"></label>
          <label>終了時間<input name="defaultEndTime"   id="defaultEndTime"   type="time" placeholder="18:00"></label>
          <label>有効
            <select name="active">
              <option value="true" selected>有効</option>
              <option value="false">無効</option>
            </select>
          </label>
          <label>就業回数<input name="employmentCount" type="number" min="0" step="1" value="0" placeholder="0"></label>
          <div id="skillFields" style="grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px"></div>
          <label style="grid-column:1/-1">備考<textarea name="memo" rows="2" placeholder="メモを入力"></textarea></label>
          <div style="grid-column:1/-1;display:flex;gap:8px;margin-top:4px">
            <button class="button" type="submit">保存</button>
            <button class="button ghost" type="reset">クリア</button>
          </div>
        </form>
      </div>
    </section>

    <div class="panel-toolbar" id="listControls" style="margin-top:0;gap:12px;align-items:center">
      <label style="margin:0">表示件数
        <select id="pageSize">
          ${PAGE_SIZE_OPTIONS.map((size)=>`<option value="${size}">${size}件</option>`).join("")}
        </select>
      </label>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <span id="pendingStatus" class="hint" style="margin:0">修正なし</span>
        <button class="button" type="button" id="applyEdits" disabled>修正実行</button>
      </div>
    </div>

    <table class="table" id="list">
      <thead>
        <tr id="listHeader"></tr>
      </thead>
      <tbody></tbody>
    </table>
    <div id="pager" class="pager" style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center"></div>
  `;
  mount.appendChild(wrap);

  if (!state.site?.userId || !state.site?.siteId) {
    const notice = document.createElement("div");
    notice.className = "hint";
    notice.textContent = "ログインし、サイトを選択すると作業者を管理できます。";
    wrap.appendChild(notice);
    return;
  }

  const form = wrap.querySelector("#form");
  const tbody = wrap.querySelector("#list tbody");
  const pager = wrap.querySelector("#pager");
  const pageSizeSelect = wrap.querySelector("#pageSize");
  const skillFields = form.querySelector("#skillFields");
  const skillConfigForm = wrap.querySelector("#skillConfigForm");
  const skillNameFields = wrap.querySelector("#skillNameFields");
  const skillLevelFields = wrap.querySelector("#skillLevelFields");
  const timeRuleStartList = wrap.querySelector("#timeRuleStartList");
  const timeRuleEndList = wrap.querySelector("#timeRuleEndList");
  const addStartRuleBtn = wrap.querySelector("#addStartRule");
  const addEndRuleBtn = wrap.querySelector("#addEndRule");
  const skillConfigContent = wrap.querySelector("#skillConfigContent");
  const skillConfigToggle = wrap.querySelector("#toggleSkillConfig");
  const workerFormContent = wrap.querySelector("#workerFormContent");
  const workerFormToggle = wrap.querySelector("#toggleWorkerForm");
  const listHeader = wrap.querySelector("#listHeader");
  const pendingStatus = wrap.querySelector("#pendingStatus");
  const applyEditsBtn = wrap.querySelector("#applyEdits");

  let skillSettings = { ...DEFAULT_SKILL_SETTINGS };
  let levelOrder = new Map();
  let isSkillConfigOpen = false;
  let isWorkerFormOpen = false;

  let currentRows = [];
  let sortKey = "workerId";
  let sortDir = "asc";
  let currentPage = 1;
  let pageSize = DEFAULT_PAGE_SIZE;
  const pendingEdits = new Map();

  const updatePendingStatus = ()=>{
    const count = pendingEdits.size;
    if(pendingStatus){
      pendingStatus.textContent = count ? `修正待ち: ${count}件` : "修正なし";
    }
    if(applyEditsBtn){
      applyEditsBtn.disabled = !count;
    }
  };

  const updateSortIndicators = () => {
    wrap.querySelectorAll("th[data-sort]").forEach((th)=>{
      const key = th.dataset.sort;
      const label = th.dataset.label || th.textContent;
      let indicator = "";
      if(key === sortKey){
        indicator = sortDir === "asc" ? " ▲" : " ▼";
      }
      th.textContent = `${label}${indicator}`;
    });
  };

  const updateLevelOrder = ()=>{
    levelOrder = new Map(skillSettings.levels.map((l, idx)=>[l.id, idx]));
  };

  const setSkillConfigVisibility = (open)=>{
    isSkillConfigOpen = !!open;
    if(skillConfigContent){
      skillConfigContent.style.display = open ? "block" : "none";
    }
    if(skillConfigToggle){
      skillConfigToggle.textContent = open ? "スキル設定を閉じる" : "スキル設定を編集";
    }
  };

  const setWorkerFormVisibility = (open)=>{
    isWorkerFormOpen = !!open;
    if(workerFormContent){
      workerFormContent.style.display = open ? "block" : "none";
    }
    if(workerFormToggle){
      workerFormToggle.textContent = open ? "新規登録フォームを閉じる" : "新規登録フォームを開く";
    }
  };

  updateLevelOrder();

  const getLevelLabel = (levelId)=>{
    const found = skillSettings.levels.find((l)=>l.id === levelId);
    return found?.name || "";
  };

  const renderSkillConfigInputs = ()=>{
    if(!skillNameFields || !skillLevelFields) return;
    skillNameFields.innerHTML = skillSettings.skills
      .map((skill, idx)=>`<label>スキル${idx + 1} 名称<input required name="skillName-${skill.id}" value="${skill.name || ""}" /></label>`) 
      .join("");
    skillLevelFields.innerHTML = skillSettings.levels
      .map((level, idx)=>`<label>ステータス${idx + 1} 名称<input required name="levelName-${level.id}" value="${level.name || ""}" /></label>`) 
      .join("");
  };

  const buildTimeRuleRow = (rule = {}, type = "start")=>{
    const row = document.createElement("div");
    row.className = "time-rule-row";
    row.style.display = "grid";
    row.style.gridTemplateColumns = "120px 1fr auto";
    row.style.gap = "6px";
    row.style.alignItems = "center";
    const hourPlaceholder = type === "start" ? "9" : "18";
    const colorPlaceholder = type === "start" ? "#dbeafe" : "#fee2e2";
    row.innerHTML = `
      <input class="time-rule-hour" type="number" min="0" max="23" step="1" placeholder="${hourPlaceholder}">
      <input class="time-rule-color" placeholder="${colorPlaceholder}">
      <button class="button ghost time-rule-remove" type="button">削除</button>
    `;
    const hourInput = row.querySelector(".time-rule-hour");
    const colorInput = row.querySelector(".time-rule-color");
    const removeBtn = row.querySelector(".time-rule-remove");
    if(hourInput && typeof rule.hour === "number"){
      hourInput.value = String(rule.hour);
    }
    if(colorInput && rule.color){
      colorInput.value = rule.color;
    }
    if(removeBtn){
      removeBtn.addEventListener("click", ()=>{
        row.remove();
      });
    }
    return row;
  };

  const appendTimeRuleRow = (list, rule = {}, type = "start")=>{
    if(!list) return;
    list.appendChild(buildTimeRuleRow(rule, type));
  };

  const setTimeRuleInputs = ()=>{
    const { startRules, endRules } = normalizeTimeRules(skillSettings.timeRules);
    if(timeRuleStartList){
      timeRuleStartList.innerHTML = "";
      startRules.forEach((rule)=>appendTimeRuleRow(timeRuleStartList, rule, "start"));
    }
    if(timeRuleEndList){
      timeRuleEndList.innerHTML = "";
      endRules.forEach((rule)=>appendTimeRuleRow(timeRuleEndList, rule, "end"));
    }
  };

  const collectSkillLevels = ()=>{
    const result = {};
    skillSettings.skills.forEach((skill)=>{
      const select = skillFields?.querySelector(`select[data-skill-id="${skill.id}"]`);
      const val = select?.value || "";
      if(val) result[skill.id] = val;
    });
    return result;
  };

  const setSkillFormValues = (levels = {})=>{
    skillSettings.skills.forEach((skill)=>{
      const select = skillFields?.querySelector(`select[data-skill-id="${skill.id}"]`);
      if(select){
        select.value = levels[skill.id] || "";
      }
    });
  };

  const renderSkillFields = ()=>{
    if(!skillFields) return;
    const existingValues = collectSkillLevels();
    const options = ["", ...skillSettings.levels.map((l)=>l.id)];
    skillFields.innerHTML = skillSettings.skills
      .map((skill)=>{
        const optionHtml = options
          .map((val)=>{
            const label = val ? getLevelLabel(val) : "未設定";
            return `<option value="${val}">${label}</option>`;
          })
          .join("");
        return `<label>${skill.name}<select data-skill-id="${skill.id}">${optionHtml}</select></label>`;
      })
      .join("");
    setSkillFormValues(existingValues);
  };

  if(workerFormToggle){
    workerFormToggle.addEventListener("click", ()=>{
      setWorkerFormVisibility(!isWorkerFormOpen);
    });
  }

  if(skillConfigToggle){
    skillConfigToggle.addEventListener("click", ()=>{
      setSkillConfigVisibility(!isSkillConfigOpen);
    });
  }

  setWorkerFormVisibility(false);
  setSkillConfigVisibility(false);

  const buildTableHeader = ()=>{
    if(!listHeader) return;
    const headers = [
      { key: "workerId", label: "ID" },
      { key: "name", label: "氏名" },
      { key: "company", label: "会社" },
      ...skillSettings.skills.map((s)=>({ key: `skill_${s.id}`, label: s.name })),
      { key: "defaultStartTime", label: "Start" },
      { key: "defaultEndTime", label: "End" },
      { key: "active", label: "active" },
      { key: "employmentCount", label: "就業回数" },
      { key: "memo", label: "備考" }
    ];
    listHeader.innerHTML = `${headers
      .map((h)=>`<th data-sort="${h.key}" data-label="${h.label}">${h.label}</th>`)
      .join("")}<th>操作</th>`;
    const currentKeys = Array.from(listHeader.querySelectorAll("th[data-sort]")).map((th)=>th.dataset.sort);
    if(!currentKeys.includes(sortKey)){
      sortKey = "workerId";
      sortDir = "asc";
    }
    bindSortHandlers();
    updateSortIndicators();
  };

  const resetTimeDefaults = ()=>{
    form.defaultStartTime.value = DEFAULT_START;
    form.defaultEndTime.value = DEFAULT_END;
    form.employmentCount.value = form.employmentCount.value || 0;
    form.memo.value = "";
    setSkillFormValues({});
  };

  const bindSortHandlers = ()=>{
    wrap.querySelectorAll("th[data-sort]").forEach((th)=>{
      th.onclick = ()=>{
        const key = th.dataset.sort;
        if(sortKey === key){
          sortDir = sortDir === "asc" ? "desc" : "asc";
        }else{
          sortKey = key;
          sortDir = "asc";
        }
        currentPage = 1;
        renderTable();
      };
    });
  };

  resetTimeDefaults();
  renderSkillConfigInputs();
  setTimeRuleInputs();
  renderSkillFields();
  buildTableHeader();
  updatePendingStatus();

  form.addEventListener("reset", ()=>{
    setTimeout(resetTimeDefaults, 0);
  });

  if(skillConfigForm){
    skillConfigForm.addEventListener("submit", async (e)=>{
      e.preventDefault();
      const fd = new FormData(skillConfigForm);
      const parseHourInput = (raw, label)=>{
        if(raw === "") return null;
        const num = Number(raw);
        if(!Number.isInteger(num) || num < 0 || num > 23){
          toast(`${label}は0〜23の整数で入力してください`,"error");
          return null;
        }
        return num;
      };
      const parseRuleRows = (list, label)=>{
        const rows = Array.from(list?.querySelectorAll(".time-rule-row") || []);
        const rules = [];
        const seen = new Set();
        for(const row of rows){
          const hourRaw = row.querySelector(".time-rule-hour")?.value?.toString().trim() ?? "";
          const colorRaw = row.querySelector(".time-rule-color")?.value?.toString().trim() ?? "";
          if(!hourRaw && !colorRaw) continue;
          if(!hourRaw || !colorRaw){
            toast(`${label}ルールは時間と色を入力してください`,"error");
            return null;
          }
          const hour = parseHourInput(hourRaw, `${label}の時間`);
          if(hour === null) return null;
          if(seen.has(hour)){
            toast(`${label}ルールに同じ時間が複数登録されています`,"error");
            return null;
          }
          const normalizedColor = normalizeHex(colorRaw);
          if(!normalizedColor){
            toast(`${label}の色は#RGBまたは#RRGGBB形式で入力してください`,"error");
            return null;
          }
          rules.push({ hour, color: `#${normalizedColor}` });
          seen.add(hour);
        }
        return rules;
      };
      const startRules = parseRuleRows(timeRuleStartList, "開始時間");
      if(startRules === null) return;
      const endRules = parseRuleRows(timeRuleEndList, "終了時間");
      if(endRules === null) return;
      const timeRules = {
        startRules,
        endRules
      };
      const next = {
        skills: skillSettings.skills.map((skill, idx)=>({
          id: skill.id,
          name: (fd.get(`skillName-${skill.id}`) || `スキル${idx + 1}`).toString().trim()
        })),
        levels: skillSettings.levels.map((level, idx)=>({
          id: level.id,
          name: (fd.get(`levelName-${level.id}`) || `ステータス${idx + 1}`).toString().trim()
        })),
        timeRules
      };
      try{
        const saved = await saveSkillSettings({
          userId: state.site.userId,
          siteId: state.site.siteId,
          skillSettings: next
        });
        skillSettings = saved;
        updateLevelOrder();
        renderSkillConfigInputs();
        setTimeRuleInputs();
        renderSkillFields();
        buildTableHeader();
        renderTable();
        toast("スキル設定を保存しました");
      }catch(err){
        console.error(err);
        toast("スキル設定の保存に失敗しました","error");
      }
    });
  }

  if(addStartRuleBtn){
    addStartRuleBtn.addEventListener("click", ()=>{
      appendTimeRuleRow(timeRuleStartList, {}, "start");
    });
  }

  if(addEndRuleBtn){
    addEndRuleBtn.addEventListener("click", ()=>{
      appendTimeRuleRow(timeRuleEndList, {}, "end");
    });
  }

  // 保存（新規/更新）
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const worker = Object.fromEntries(fd.entries());
    if(!worker.workerId){ toast("作業者IDは必須です","error"); return; }
    worker.defaultStartTime = worker.defaultStartTime || DEFAULT_START;
    worker.defaultEndTime = worker.defaultEndTime || DEFAULT_END;
    worker.employmentCount = Number(worker.employmentCount || 0);
    worker.memo = worker.memo || "";
    const selectedSkillLevels = collectSkillLevels();
    worker.skillLevels = selectedSkillLevels;
    worker.skills = skillSettings.skills
      .map((skill)=>{
        const levelId = selectedSkillLevels[skill.id];
        const label = getLevelLabel(levelId);
        return levelId && label ? `${skill.name}: ${label}` : "";
      })
      .filter(Boolean);
    try{
      await upsertWorker({
        userId: state.site.userId,
        siteId: state.site.siteId,
        ...worker
      });
      toast(`保存しました：${worker.workerId}`);
      form.reset();
      form.querySelector('select[name="active"]').value = "true";
      resetTimeDefaults();
    }catch(err){
      console.error(err);
      toast("保存に失敗しました","error");
    }
  });

  pageSizeSelect.value = String(pageSize);
  pageSizeSelect.addEventListener("change", ()=>{
    const next = Number(pageSizeSelect.value) || DEFAULT_PAGE_SIZE;
    pageSize = next;
    currentPage = 1;
    renderTable();
  });

  if(applyEditsBtn){
    applyEditsBtn.addEventListener("click", async ()=>{
      if(!pendingEdits.size){
        toast("修正はありません");
        return;
      }
      applyEditsBtn.disabled = true;
      const originalLabel = applyEditsBtn.textContent;
      applyEditsBtn.textContent = "保存中...";
      const errors = [];
      for(const [workerId, worker] of Array.from(pendingEdits.entries())){
        try{
          await upsertWorker({
            userId: state.site.userId,
            siteId: state.site.siteId,
            ...worker
          });
          pendingEdits.delete(workerId);
        }catch(err){
          errors.push(workerId);
          console.error(err);
        }
      }
      applyEditsBtn.textContent = originalLabel || "修正実行";
      applyEditsBtn.disabled = false;
      updatePendingStatus();
      if(errors.length){
        toast(`保存に失敗しました: ${errors.join(", ")}`,"error");
      }else{
        toast("修正を反映しました");
      }
    });
  }

  const getFieldValue = (row, key)=>{
    if(key.startsWith("skill_")){
      const levelId = row.skillLevels?.[key.replace("skill_", "")] || "";
      const order = levelOrder.get(levelId);
      if(typeof order === "number") return order;
      return levelId || "";
    }
    if(key === "active"){
      return row.active ? 1 : 0;
    }
    if(key === "defaultStartTime"){
      return row.defaultStartTime || DEFAULT_START;
    }
    if(key === "defaultEndTime"){
      return row.defaultEndTime || DEFAULT_END;
    }
    if(key === "employmentCount"){
      return Number(row.employmentCount || 0);
    }
    if(key === "memo"){
      return row.memo || "";
    }
    return row[key] ?? "";
  };

  const normalizeForCompare = (worker)=>({
    workerId: worker.workerId,
    name: worker.name || "",
    company: worker.company || "",
    defaultStartTime: worker.defaultStartTime || DEFAULT_START,
    defaultEndTime: worker.defaultEndTime || DEFAULT_END,
    active: !!worker.active,
    employmentCount: Number(worker.employmentCount || 0),
    memo: worker.memo || "",
    skillLevels: normalizeSkillLevels(worker.skillLevels)
  });

  const isSameWorker = (a,b)=>{
    return JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b));
  };

  const readRowInputs = (tr)=>{
    const workerId = tr.dataset.workerId;
    const base = currentRows.find(r=>r.workerId === workerId) || {};
    const name = tr.querySelector('input[data-field="name"]')?.value || "";
    const company = tr.querySelector('input[data-field="company"]')?.value || "";
    const defaultStartTime = tr.querySelector('input[data-field="defaultStartTime"]')?.value || DEFAULT_START;
    const defaultEndTime = tr.querySelector('input[data-field="defaultEndTime"]')?.value || DEFAULT_END;
    const active = (tr.querySelector('select[data-field="active"]')?.value || "true") === "true";
    const employmentCount = Number(tr.querySelector('input[data-field="employmentCount"]')?.value || 0);
    const memo = tr.querySelector('textarea[data-field="memo"]')?.value || "";
    const skillLevels = {};
    tr.querySelectorAll('select[data-field="skill"]').forEach((select)=>{
      const skillId = select.dataset.skillId;
      const val = select.value || "";
      if(val){
        skillLevels[skillId] = val;
      }
    });
    const skills = skillSettings.skills
      .map((skill)=>{
        const levelId = skillLevels[skill.id];
        const label = getLevelLabel(levelId);
        return levelId && label ? `${skill.name}: ${label}` : "";
      })
      .filter(Boolean);

    const { panel, panelColor, ...restBase } = base;
    return {
      ...restBase,
      workerId,
      name,
      company,
      defaultStartTime,
      defaultEndTime,
      active,
      employmentCount,
      memo,
      skillLevels,
      skills
    };
  };

  const setRowInputs = (tr, data)=>{
    const setVal = (selector, value)=>{
      const el = tr.querySelector(selector);
      if(!el) return;
      if(el.tagName === "TEXTAREA"){
        el.value = value || "";
      }else{
        el.value = value || "";
      }
    };
    setVal('input[data-field="name"]', data.name || "");
    setVal('input[data-field="company"]', data.company || "");
    setVal('input[data-field="defaultStartTime"]', data.defaultStartTime || DEFAULT_START);
    setVal('input[data-field="defaultEndTime"]', data.defaultEndTime || DEFAULT_END);
    setVal('select[data-field="active"]', data.active ? "true" : "false");
    setVal('input[data-field="employmentCount"]', Number(data.employmentCount || 0));
    setVal('textarea[data-field="memo"]', data.memo || "");
    tr.querySelectorAll('select[data-field="skill"]').forEach((select)=>{
      const skillId = select.dataset.skillId;
      select.value = data.skillLevels?.[skillId] || "";
    });
  };

  const captureRowEdit = (tr)=>{
    const next = readRowInputs(tr);
    const base = currentRows.find(r=>r.workerId === next.workerId);
    if(base && isSameWorker(base, next)){
      pendingEdits.delete(next.workerId);
    }else{
      pendingEdits.set(next.workerId, next);
    }
    updatePendingStatus();
  };

  const resetRowInputs = (workerId)=>{
    const tr = tbody.querySelector(`tr[data-worker-id="${workerId}"]`);
    const base = currentRows.find(r=>r.workerId === workerId);
    if(tr && base){
      setRowInputs(tr, base);
      pendingEdits.delete(workerId);
      updatePendingStatus();
    }
  };

  const renderPager = (totalPages)=>{
    pager.innerHTML = "";
    if(totalPages <= 1){
      pager.style.display = "none";
      return;
    }
    pager.style.display = "flex";

    const makeBtn = (label, disabled, onClick)=>{
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "button ghost";
      btn.textContent = label;
      btn.disabled = disabled;
      btn.addEventListener("click", onClick);
      return btn;
    };

    pager.appendChild(makeBtn("前へ", currentPage === 1, ()=>{
      if(currentPage > 1){
        currentPage--;
        renderTable();
      }
    }));

    for(let page = 1; page <= totalPages; page++){
      const btn = makeBtn(String(page), page === currentPage, ()=>{
        currentPage = page;
        renderTable();
      });
      if(page === currentPage){
        btn.className = "button";
      }
      pager.appendChild(btn);
    }

    pager.appendChild(makeBtn("次へ", currentPage === totalPages, ()=>{
      if(currentPage < totalPages){
        currentPage++;
        renderTable();
      }
    }));
  };

  const renderTable = ()=>{
    const rows = [...currentRows];
    rows.sort((a,b)=>{
      const av = getFieldValue(a, sortKey);
      const bv = getFieldValue(b, sortKey);
      if(typeof av === "number" && typeof bv === "number"){
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const astr = String(av).toLocaleLowerCase();
      const bstr = String(bv).toLocaleLowerCase();
      if(astr === bstr) return 0;
      const cmp = astr < bstr ? -1 : 1;
      return sortDir === "asc" ? cmp : -cmp;
    });

    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    if(currentPage > totalPages){
      currentPage = totalPages;
    }
    const start = (currentPage - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);

    tbody.innerHTML = "";
    pageRows.forEach(w=>{
      const tr = document.createElement("tr");
      tr.dataset.workerId = w.workerId;
      const source = pendingEdits.get(w.workerId) || w;
      const employmentCount = Number(source.employmentCount || 0);
      const memo = source.memo || "";
      const skillCells = skillSettings.skills
        .map((skill)=>{
          const levelId = source.skillLevels?.[skill.id] || "";
          const options = ["", ...skillSettings.levels.map((l)=>l.id)]
            .map((val)=>{
              const label = val ? getLevelLabel(val) : "未設定";
              const selected = val === levelId ? "selected" : "";
              return `<option value=\"${val}\" ${selected}>${label}</option>`;
            })
            .join("");
          return `<td><select data-field=\"skill\" data-skill-id=\"${skill.id}\">${options}</select></td>`;
        })
        .join("");

      tr.innerHTML = `
        <td class="mono">${w.workerId}</td>
        <td><input data-field="name" value="${source.name || ""}" placeholder="山田 太郎"></td>
        <td><input data-field="company" value="${source.company || ""}" placeholder="THERE"></td>
        ${skillCells}
        <td><input data-field="defaultStartTime" type="time" value="${source.defaultStartTime || DEFAULT_START}"></td>
        <td><input data-field="defaultEndTime" type="time" value="${source.defaultEndTime || DEFAULT_END}"></td>
        <td>
          <select data-field="active">
            <option value="true" ${source.active !== false ? "selected" : ""}>有効</option>
            <option value="false" ${source.active === false ? "selected" : ""}>無効</option>
          </select>
        </td>
        <td class="mono"><input data-field="employmentCount" type="number" min="0" step="1" value="${employmentCount}" style="width:100%"></td>
        <td><textarea data-field="memo" rows="1">${memo}</textarea></td>
        <td class="row-actions" style="white-space:nowrap">
          <button data-reset="${w.workerId}" class="button ghost">元に戻す</button>
          <button data-del="${w.workerId}" class="button" style="background:#dc2626">削除</button>
        </td>
      `;
      tbody.appendChild(tr);

      tr.querySelectorAll("input, select, textarea").forEach((el)=>{
        const evt = el.tagName === "SELECT" ? "change" : "input";
        el.addEventListener(evt, ()=>captureRowEdit(tr));
      });

      const resetBtn = tr.querySelector("button[data-reset]");
      if(resetBtn){
        resetBtn.onclick = ()=>resetRowInputs(w.workerId);
      }
    });

    // 削除
    tbody.querySelectorAll("button[data-del]").forEach(btn=>{
      btn.onclick = async ()=>{
        const id = btn.dataset.del;
        const ok = confirm(`削除しますか？ ${id}`);
        if(!ok) return;
        try {
          await removeWorker({
            userId: state.site.userId,
            siteId: state.site.siteId,
            workerId: id
          });
          toast(`削除しました：${id}`);
        } catch (e){
          console.error(e);
          toast("削除に失敗しました","error");
        }
      };
    });

    renderPager(totalPages);
    updatePendingStatus();
    updateSortIndicators();
  };

    const unsubWorkers = subscribeWorkers(
      {
        userId: state.site.userId,
        siteId: state.site.siteId
      },
      (rows)=>{
        currentRows = rows.map((row)=>(
          {
            ...row,
            defaultStartTime: row.defaultStartTime || DEFAULT_START,
            defaultEndTime: row.defaultEndTime || DEFAULT_END,
            employmentCount: Number(row.employmentCount || 0),
            memo: row.memo || "",
            skillLevels: normalizeSkillLevels(row.skillLevels)
          }
        ));
        const ids = new Set(currentRows.map((r)=>r.workerId));
        Array.from(pendingEdits.keys()).forEach((id)=>{
          if(!ids.has(id)) pendingEdits.delete(id);
        });
        renderTable();
      }
    );

    const unsubSkillSettings = subscribeSkillSettings(
      {
        userId: state.site.userId,
        siteId: state.site.siteId
      },
      (settings)=>{
        skillSettings = settings || { ...DEFAULT_SKILL_SETTINGS };
        updateLevelOrder();
        renderSkillConfigInputs();
        setTimeRuleInputs();
        renderSkillFields();
        buildTableHeader();
        renderTable();
      }
    );

  // ページ離脱時
  window.addEventListener("hashchange", ()=>{ try{unsubWorkers();}catch{} try{unsubSkillSettings();}catch{} }, { once:true });
}
