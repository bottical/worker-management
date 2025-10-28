import { toast } from "../core/ui.js";

export function makePool(mount, ids = [], onChange){
  mount.innerHTML = "";
  ids.forEach(id => mount.appendChild(card(id)));
  onChange?.();

  function card(workerId){
    const el = document.createElement("div");
    el.className = "card";
    el.draggable = true;
    el.dataset.workerId = workerId;
    el.dataset.inPool = "1";

    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = workerId.slice(0,1).toUpperCase();

    const main = document.createElement("div");
    const id = document.createElement("div");
    id.className = "mono";
    id.textContent = workerId;
    const sub = document.createElement("div");
    sub.className = "hint"; sub.textContent = "未配置";

    main.appendChild(id); main.appendChild(sub);
    el.appendChild(av); el.appendChild(main);

    el.addEventListener("dragstart", e => {
      const payload = JSON.stringify({ type:"pool", workerId });
      e.dataTransfer.setData("text/plain", payload);
      e.dataTransfer.effectAllowed = "move";
      el.classList.add("dragging");
    });
    el.addEventListener("dragend", () => el.classList.remove("dragging"));

    el.addEventListener("click", async ()=>{
      try{ await navigator.clipboard.writeText(workerId); toast(`IDコピー：${workerId}`); }
      catch{ toast("コピー不可","error"); }
    });

    return el;
  }
}
