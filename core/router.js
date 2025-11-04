import { renderDashboard } from "../pages/dashboard.html.js";
import { renderImport } from "../pages/import.html.js";
import { renderUsers } from "../pages/users.html.js";   // ← 追加
import { renderAreas } from "../pages/areas.html.js";

const routes = {
  "/dashboard": renderDashboard,
  "/import": renderImport,
  "/users": renderUsers,          // ← 追加
  "/areas": renderAreas
};

export function boot(){
  const mount = document.getElementById("app");
  function onRoute(){
    const path = (location.hash.replace(/^#/, "") || "/dashboard");
    const render = routes[path] || routes["/dashboard"];
    mount.innerHTML = "";
    render(mount);
  }
  window.addEventListener("hashchange", onRoute);
  onRoute();
}
