import { renderDashboard } from "../pages/dashboard.html.js";
import { renderImport } from "../pages/import.html.js";
import { renderUsers } from "../pages/users.html.js"; // ← 追加
import { renderAreas } from "../pages/areas.html.js";
import { renderSearch } from "../pages/search.html.js";
import { renderLogin } from "../pages/login.html.js";
import { state, subscribe } from "./store.js";

const routes = {
  "/dashboard": renderDashboard,
  "/import": renderImport,
  "/users": renderUsers, // ← 追加
  "/areas": renderAreas,
  "/search": renderSearch,
  "/login": renderLogin
};

export function boot(){
  const mount = document.getElementById("app");
  function onRoute(){
    const path = (location.hash.replace(/^#/, "") || "/dashboard");
    const needsAuth = path !== "/login";
    if (needsAuth && !state.user) {
      mount.innerHTML = "";
      renderLogin(mount);
      return;
    }
    const render = routes[path] || routes[needsAuth ? "/dashboard" : "/login"];
    mount.innerHTML = "";
    render(mount);
  }
  window.addEventListener("hashchange", onRoute);
  onRoute();
  subscribe((_, partial) => {
    // 再描画は「ユーザー変化」または「siteId が変わった場合」に限定
    if (Object.prototype.hasOwnProperty.call(partial, "user")) {
      onRoute();
      return;
    }
    if (Object.prototype.hasOwnProperty.call(partial, "site")) {
      const s = partial.site || {};
      if (Object.prototype.hasOwnProperty.call(s, "siteId")) {
        onRoute();
      }
    }
  });
}
