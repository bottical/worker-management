import { state } from "../core/store.js";
import { subscribeWorkers, upsertWorker, removeWorker } from "../api/firebase.js";
import { toast } from "../core/ui.js";

const DEFAULT_START = "09:00";
const DEFAULT_END = "18:00";
const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 50];
const HEX_COLOR_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const normalizeHex = (input)=>{
  if(!input) return null;
  const hex = input.trim();
  if(!HEX_COLOR_PATTERN.test(hex)) return null;
  let value = hex.slice(1);
  if(value.length === 3){
    value = value.split("").map((c)=>c + c).join("");
  }
  return value;
};

const useLightText = (color)=>{
  const normalized = normalizeHex(color);
  if(!normalized) return false;
  const [r, g, b] = [
    parseInt(normalized.slice(0, 2), 16) / 255,
    parseInt(normalized.slice(2, 4), 16) / 255,
    parseInt(normalized.slice(4, 6), 16) / 255
  ];
  const toLinear = (channel)=>{
    return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
  return luminance < 0.5;
};

export function renderUsers(mount){
  const wrap = document.createElement("div");
  wrap.className = "panel";
  wrap.innerHTML = `
    <h2>ユーザー管理</h2>
    <div class="hint">作業者マスタの追加・編集・削除ができます。</div>

    <form id="form" style="display:grid;grid-template-columns:repeat(4, minmax(180px,1fr));gap:8px;margin:12px 0">
      <label>作業者ID<input name="workerId" required placeholder="ID001"></label>
      <label>氏名<input name="name" placeholder="山田 太郎"></label>
      <label>会社<input name="company" placeholder="THERE"></label>
      <label>雇用区分<input name="employmentType" placeholder="派遣/正社員など"></label>
      <label>派遣元<input name="agency" placeholder="派遣会社名"></label>
      <label>スキル（カンマ区切り）<input name="skills" placeholder="検品,梱包"></label>
      <label>開始時間<input name="defaultStartTime" id="defaultStartTime" type="time" placeholder="09:00"></label>
      <label>終了時間<input name="defaultEndTime"   id="defaultEndTime"   type="time" placeholder="18:00"></label>
      <label>有効
        <select name="active">
          <option value="true" selected>有効</option>
          <option value="false">無効</option>
        </select>
      </label>
      <label>カード色<input name="panelColor" placeholder="#e2e8f0"></label>
      <label>バッジ（カンマ区切り）<input name="badges" placeholder="新人,応援可"></label>
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
        <tr>
          <th data-sort="workerId" data-label="ID">ID</th>
          <th data-sort="name" data-label="氏名">氏名</th>
          <th data-sort="company" data-label="会社">会社</th>
          <th data-sort="employmentType" data-label="区分">区分</th>
          <th data-sort="agency" data-label="派遣元">派遣元</th>
          <th data-sort="skills" data-label="skills">skills</th>
          <th data-sort="defaultStartTime" data-label="Start">Start</th>
          <th data-sort="defaultEndTime" data-label="End">End</th>
          <th data-sort="active" data-label="active">active</th>
          <th data-sort="panelColor" data-label="カード色">カード色</th>
          <th>操作</th>
        </tr>
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

  const resetTimeDefaults = ()=>{
    form.defaultStartTime.value = DEFAULT_START;
    form.defaultEndTime.value = DEFAULT_END;
  };

  resetTimeDefaults();
  form.addEventListener("reset", ()=>{
    setTimeout(resetTimeDefaults, 0);
  });

  // 保存（新規/更新）
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const worker = Object.fromEntries(fd.entries());
    if(!worker.workerId){ toast("作業者IDは必須です","error"); return; }
    worker.defaultStartTime = worker.defaultStartTime || DEFAULT_START;
    worker.defaultEndTime = worker.defaultEndTime || DEFAULT_END;
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

  let currentRows = [];
  let sortKey = "workerId";
  let sortDir = "asc";
  let currentPage = 1;
  let pageSize = DEFAULT_PAGE_SIZE;

  pageSizeSelect.value = String(pageSize);
  pageSizeSelect.addEventListener("change", ()=>{
    const next = Number(pageSizeSelect.value) || DEFAULT_PAGE_SIZE;
    pageSize = next;
    currentPage = 1;
    renderTable();
  });

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

  const getFieldValue = (row, key)=>{
    if(key === "skills"){
      return (row.skills || []).join(", ");
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
      const panelTextColor = useLight ? "#fff" : "#0f172a";
      const panelBorderColor = useLight ? "rgba(255,255,255,0.4)" : "rgba(15,23,42,0.2)";

      tr.innerHTML = `
        <td class="mono">${w.workerId}</td>
        <td>${w.name||""}</td>
        <td>${w.company||""}</td>
        <td>${w.employmentType||""}</td>
        <td>${w.agency||""}</td>
        <td>${(w.skills||[]).join(", ")}</td>
        <td>${w.defaultStartTime || DEFAULT_START}</td>
        <td>${w.defaultEndTime || DEFAULT_END}</td>
        <td>${w.active ? "✔" : ""}</td>
        <td>${panelColor ? `<span class="color-chip" style="background:${panelColor};color:${panelTextColor};border-color:${panelBorderColor}">${panelColor}</span>` : ""}</td>
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
        form.employmentType.value = row.employmentType||"";
        form.agency.value = row.agency||"";
        form.skills.value = (row.skills||[]).join(", ");
        form.defaultStartTime.value = row.defaultStartTime || DEFAULT_START;
        form.defaultEndTime.value = row.defaultEndTime || DEFAULT_END;
        form.active.value = row.active ? "true" : "false";
        form.panelColor.value = row.panel?.color || "";
        form.badges.value = (row.panel?.badges||[]).join(", ");
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

  wrap.querySelectorAll("th[data-sort]").forEach((th)=>{
    th.addEventListener("click", ()=>{
      const key = th.dataset.sort;
      if(sortKey === key){
        sortDir = sortDir === "asc" ? "desc" : "asc";
      }else{
        sortKey = key;
        sortDir = "asc";
      }
      currentPage = 1;
      renderTable();
    });
  });

  // 一覧購読
  const unsub = subscribeWorkers(
    {
      userId: state.site.userId,
      siteId: state.site.siteId
    },
    (rows)=>{
    currentRows = rows.map((row)=>({
      ...row,
      defaultStartTime: row.defaultStartTime || DEFAULT_START,
      defaultEndTime: row.defaultEndTime || DEFAULT_END
    }));
    renderTable();
  });

  // ページ離脱時
  window.addEventListener("hashchange", ()=>{ try{unsub();}catch{} }, { once:true });
}
