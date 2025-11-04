import { subscribeWorkers, upsertWorker, removeWorker } from "../api/firebase.js";
import { toast } from "../core/ui.js";

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

    <table class="table" id="list">
      <thead>
        <tr>
          <th>ID</th><th>氏名</th><th>会社</th><th>区分</th><th>派遣元</th><th>skills</th><th>End</th><th>active</th><th>操作</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
  `;
  mount.appendChild(wrap);

  const form = wrap.querySelector("#form");
  const tbody = wrap.querySelector("#list tbody");

  // 保存（新規/更新）
  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const fd = new FormData(form);
    const worker = Object.fromEntries(fd.entries());
    if(!worker.workerId){ toast("作業者IDは必須です","error"); return; }
    try{
      await upsertWorker(worker);
      toast(`保存しました：${worker.workerId}`);
      form.reset();
      form.querySelector('select[name="active"]').value = "true";
    }catch(err){
      console.error(err);
      toast("保存に失敗しました","error");
    }
  });

  // 一覧購読
  const unsub = subscribeWorkers((rows)=>{
    tbody.innerHTML = "";
    rows.forEach(w=>{
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td class="mono">${w.workerId}</td>
        <td>${w.name||""}</td>
        <td>${w.company||""}</td>
        <td>${w.employmentType||""}</td>
        <td>${w.agency||""}</td>
        <td>${(w.skills||[]).join(", ")}</td>
        <td>${w.defaultEndTime||""}</td>
        <td>${w.active ? "✔" : ""}</td>
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
        const row = rows.find(r=>r.workerId===id);
        if(!row) return;
        form.workerId.value = row.workerId;
        form.name.value = row.name||"";
        form.company.value = row.company||"";
        form.employmentType.value = row.employmentType||"";
        form.agency.value = row.agency||"";
        form.skills.value = (row.skills||[]).join(", ");
        form.defaultStartTime.value = row.defaultStartTime || "";
        form.defaultEndTime.value = row.defaultEndTime || "";
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
          await removeWorker(id);
          toast(`削除しました：${id}`);
        } catch (e){
          console.error(e);
          toast("削除に失敗しました","error");
        }
      };
    });
  });

  // ページ離脱時
  window.addEventListener("hashchange", ()=>{ try{unsub();}catch{} }, { once:true });
}
