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
import { getContrastTextColor, useLightText } from "../core/colors.js";

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

export function renderUsers(mount){
  const wrap = document.createElement("div");
  wrap.className = "panel";
  wrap.innerHTML = `
    <h2>ユーザー管理</h2>
    <div class="hint">作業者マスタの追加・編集・削除ができます。</div>

    <section class="panel-sub" id="skillConfigSection" style="margin-top:12px">
      <h3>スキル設定</h3>
      <div class="hint">スキル名とステータス名を編集できます（4種×3段階）。</div>
      <form id="skillConfigForm" class="form" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));margin-top:12px">
        <div id="skillNameFields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px"></div>
        <div id="skillLevelFields" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:8px"></div>
        <div class="form-actions" style="grid-column:1/-1">
          <button class="button" type="submit">スキル設定を保存</button>
        </div>
      </form>
    </section>

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
      <label>カード色<input name="panelColor" placeholder="#e2e8f0"></label>
      <label>就業回数<input name="employmentCount" type="number" min="0" step="1" value="0" placeholder="0"></label>
      <div id="skillFields" style="grid-column:1/-1;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px"></div>
      <label style="grid-column:1/-1">備考<textarea name="memo" rows="2" placeholder="メモを入力"></textarea></label>
      <div style="grid-column:1/-1;display:flex;gap:8px;margin-top:4px">
        <button class="button" type="submit">保存</button>
        <button class="button ghost" type="reset">クリア</button>
      </div>
    </form>

    <div class="panel-toolbar" id="listControls" style="margin-top:0">
      <label>表示件数
        <select id="pageSize">
          ${PAGE_SIZE_OPTIONS.map((size)=>`<option value="${size}">${size}件</option>`).join("")}
        </select>
      </label>
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
  const listHeader = wrap.querySelector("#listHeader");

  let skillSettings = { ...DEFAULT_SKILL_SETTINGS };
  let levelOrder = new Map();

  let currentRows = [];
  let sortKey = "workerId";
  let sortDir = "asc";
  let currentPage = 1;
  let pageSize = DEFAULT_PAGE_SIZE;

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
      { key: "panelColor", label: "カード色" },
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
  renderSkillFields();
  buildTableHeader();

  form.addEventListener("reset", ()=>{
    setTimeout(resetTimeDefaults, 0);
  });

  if(skillConfigForm){
    skillConfigForm.addEventListener("submit", async (e)=>{
      e.preventDefault();
      const fd = new FormData(skillConfigForm);
      const next = {
        skills: skillSettings.skills.map((skill, idx)=>({
          id: skill.id,
          name: (fd.get(`skillName-${skill.id}`) || `スキル${idx + 1}`).toString().trim()
        })),
        levels: skillSettings.levels.map((level, idx)=>({
          id: level.id,
          name: (fd.get(`levelName-${level.id}`) || `ステータス${idx + 1}`).toString().trim()
        }))
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
    if(key === "panelColor"){
      return row.panel?.color || row.panelColor || "";
    }
    if(key === "employmentCount"){
      return Number(row.employmentCount || 0);
    }
    if(key === "memo"){
      return row.memo || "";
    }
    return row[key] ?? "";
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
      const panelColor = w.panel?.color || w.panelColor || "";
      const useLight = useLightText(panelColor);
      const panelTextColor = getContrastTextColor(panelColor);
      const panelBorderColor = useLight ? "rgba(255,255,255,0.4)" : "rgba(15,23,42,0.2)";
      const employmentCount = Number(w.employmentCount || 0);
      const memo = w.memo || "";
      const skillCells = skillSettings.skills
        .map((skill)=>{
          const levelId = w.skillLevels?.[skill.id] || "";
          const label = getLevelLabel(levelId);
          return `<td>${label || ""}</td>`;
        })
        .join("");

      tr.innerHTML = `
        <td class="mono">${w.workerId}</td>
        <td>${w.name||""}</td>
        <td>${w.company||""}</td>
        ${skillCells}
        <td>${w.defaultStartTime || DEFAULT_START}</td>
        <td>${w.defaultEndTime || DEFAULT_END}</td>
        <td>${w.active ? "✔" : ""}</td>
        <td>${panelColor ? `<span class="color-chip" style="background:${panelColor};color:${panelTextColor};border-color:${panelBorderColor}">${panelColor}</span>` : ""}</td>
        <td class="mono">${employmentCount}</td>
        <td>${memo}</td>
        <td class="row-actions">
          <button data-edit="${w.workerId}" class="button ghost">編集</button>
          <button data-del="${w.workerId}" class="button" style="background:#dc2626">削除</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    // 編集
    tbody.querySelectorAll("button[data-edit]").forEach(btn=>{
      btn.onclick = ()=>{
        const id = btn.dataset.edit;
        const row = currentRows.find(r=>r.workerId===id);
        if(!row) return;
        form.workerId.value = row.workerId;
        form.name.value = row.name||"";
        form.company.value = row.company||"";
        form.defaultStartTime.value = row.defaultStartTime || DEFAULT_START;
        form.defaultEndTime.value = row.defaultEndTime || DEFAULT_END;
        form.active.value = row.active ? "true" : "false";
        form.panelColor.value = row.panel?.color || "";
        form.employmentCount.value = Number(row.employmentCount || 0);
        form.memo.value = row.memo || "";
        setSkillFormValues(row.skillLevels || {});
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
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
    renderTable();
  });

  const unsubSkillSettings = subscribeSkillSettings(
    {
      userId: state.site.userId,
      siteId: state.site.siteId
    },
    (settings)=>{
      skillSettings = settings || { ...DEFAULT_SKILL_SETTINGS };
      updateLevelOrder();
      renderSkillConfigInputs();
      renderSkillFields();
      buildTableHeader();
      renderTable();
    }
  );

  // ページ離脱時
  window.addEventListener("hashchange", ()=>{ try{unsubWorkers();}catch{} try{unsubSkillSettings();}catch{} }, { once:true });
}
