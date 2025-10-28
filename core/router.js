import { renderDashboard } from "../pages/dashboard.html.js";
import { renderImport } from "../pages/import.html.js";

const routes = {
  "/dashboard": renderDashboard,
  "/import": renderImport,
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
