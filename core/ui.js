const toastEl = (()=> {
  const el = document.createElement("div");
  el.className = "toast";
  document.body.appendChild(el);
  return el;
})();

export function toast(msg, type="info"){
  toastEl.textContent = msg;
  toastEl.style.background = (type==="error") ? "#b91c1c" : "#111827";
  toastEl.classList.add("show");
  setTimeout(()=> toastEl.classList.remove("show"), 2600);
}
