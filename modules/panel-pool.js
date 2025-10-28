import { toast } from "../core/ui.js";

/**
 * プール（未配置リスト）
 * @param mount DOM要素
 * @param workers [{ workerId, name, defaultStartTime?, defaultEndTime? }]
 * @param onChange コールバック
 */
export function makePool(mount, workers = [], onChange){
  mount.innerHTML = "";
  workers.forEach(w => mount.appendChild(card(w)));
  onChange?.();

  function fmtRange(s, e){
    const norm = (t)=> (t||"").toString().trim();
    const toLabel=(t)=>{
      if(!t) return "";
      const m = String(t).match(/^(\d{1,2})(?::?(\d{2}))?$/); // "9"|"09"|"09:00"|"0900"
      if(!m) return t;
      const hh = String(parseInt(m[1],10));
      const mm = (m[2]||"00");
      return (mm==="00") ? hh : `${hh}:${mm}`;
    };
    const a = toLabel(norm(s)), b = toLabel(norm(e));
    if(!a && !b) return "";
    if(a && b) return `【${a}-${b}】`;
    return `【${a||b}】`;
  }

  function card(worker){
    const el = document.createElement("div");
    el.className = "card";
    el.draggable = true;
    el.dataset.workerId = worker.workerId;
    el.dataset.inPool = "1";

    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = (worker.name?.charAt(0) || "？");

    const main = document.createElement("div");
    const title = document.createElement("div");
    title.className = "mono";
    const meta = fmtRange(worker.defaultStartTime, worker.defaultEndTime);
    title.textContent = (worker.name || worker.workerId) + (meta ? ` ${meta}` : "");
    const sub = document.createElement("div");
    sub.className = "hint";
    sub.textContent = "未配置";

    main.appendChild(title);
    main.appendChild(sub);
    el.appendChild(av);
    el.appendChild(main);

    el.addEventListener("dragstart", e => {
      const payload = JSON.stringify({
        type: "pool",
        workerId: worker.workerId,
        name: worker.name,
        defaultStartTime: worker.defaultStartTime,
        defaultEndTime: worker.defaultEndTime
      });
      e.dataTransfer.setData("text/plain", payload);
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));

    el.addEventListener("click", async ()=>{
      try {
        await navigator.clipboard.writeText(worker.workerId);
        toast(`IDコピー：${worker.workerId}`);
      } catch {
        toast("コピー不可", "error");
      }
    });

    return el;
  }
}
