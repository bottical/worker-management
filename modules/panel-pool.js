import { toast } from "../core/ui.js";

/**
 * プール（未配置リスト）
 * @param mount DOM要素
 * @param workers [{workerId, name}]
 * @param onChange コールバック
 */
export function makePool(mount, workers = [], onChange){
  mount.innerHTML = "";
  workers.forEach(w => mount.appendChild(card(w)));
  onChange?.();

  function card(worker){
    const el = document.createElement("div");
    el.className = "card";
    el.draggable = true;
    el.dataset.workerId = worker.workerId;
    el.dataset.inPool = "1";

    const av = document.createElement("div");
    av.className = "avatar";
    av.textContent = worker.name?.charAt(0) || "？";

    const main = document.createElement("div");
    const name = document.createElement("div");
    name.className = "mono";
    name.textContent = worker.name || worker.workerId;
    const sub = document.createElement("div");
    sub.className = "hint";
    sub.textContent = "未配置";

    main.appendChild(name);
    main.appendChild(sub);
    el.appendChild(av);
    el.appendChild(main);

    el.addEventListener("dragstart", e => {
      const payload = JSON.stringify({ type: "pool", workerId: worker.workerId, name: worker.name });
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
