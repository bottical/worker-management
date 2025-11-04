import { loginWithEmailPassword, logout, onAuthState, subscribeSites } from "../api/firebase.js";
import { set, state } from "../core/store.js";
import { toast } from "../core/ui.js";

export function renderLogin(mount) {
  mount.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "panel";
  wrap.innerHTML = `
    <h2>ログイン</h2>
    <div class="hint">登録済みのアカウントでログインしてください。</div>
    <form id="loginForm" class="form" style="max-width:360px;margin-top:16px">
      <label>メールアドレス<input type="email" name="email" required autocomplete="email" /></label>
      <label>パスワード<input type="password" name="password" required autocomplete="current-password" /></label>
      <div class="form-actions">
        <button type="submit" class="button" style="width:100%">ログイン</button>
      </div>
    </form>
    <div id="loginStatus" class="hint" style="margin-top:16px"></div>
  `;
  mount.appendChild(wrap);

  const form = wrap.querySelector("#loginForm");
  const status = wrap.querySelector("#loginStatus");

  if (state.user) {
    status.textContent = `${state.user.email || state.user.uid} としてログイン済みです。`;
    form.style.display = "none";
    const signOutBtn = document.createElement("button");
    signOutBtn.className = "button";
    signOutBtn.textContent = "ログアウト";
    signOutBtn.addEventListener("click", async () => {
      try {
        await logout();
      } catch (err) {
        console.error("logout failed", err);
        toast("ログアウトに失敗しました", "error");
      }
    });
    status.appendChild(document.createElement("br"));
    status.appendChild(signOutBtn);
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const email = (fd.get("email") || "").toString().trim();
    const password = (fd.get("password") || "").toString();
    if (!email || !password) {
      toast("メールアドレスとパスワードを入力してください", "error");
      return;
    }
    form.querySelectorAll("input,button").forEach((el) => (el.disabled = true));
    status.textContent = "サインイン中...";
    try {
      await loginWithEmailPassword(email, password);
      status.textContent = "ログインしました";
    } catch (err) {
      console.error("login failed", err);
      toast("ログインに失敗しました。入力内容をご確認ください。", "error");
      status.textContent = "ログインに失敗しました";
    } finally {
      form.querySelectorAll("input,button").forEach((el) => (el.disabled = false));
    }
  });
}

export function attachSiteSubscription() {
  let unsubscribe = () => {};
  onAuthState(async (user) => {
    try {
      unsubscribe();
    } catch (err) {
      console.warn("unsubscribe sites failed", err);
    }
    if (!user) {
      set({ user: null, sites: [], site: { userId: null, siteId: "", floorId: "" } });
      return;
    }
    const uid = user.uid;
    set({ user: { uid, email: user.email || "", displayName: user.displayName || "" } });
    unsubscribe = subscribeSites(uid, (sites) => {
      set({ sites });
      const current = state.site?.siteId;
      if (!current || !sites.some((s) => s.id === current)) {
        const primary = sites[0] || { id: "", defaultFloorId: "" };
        const floorId = primary.defaultFloorId || primary.defaultFloor || "";
        set({
          site: { userId: uid, siteId: primary.id || "", floorId: floorId || state.site?.floorId || "" }
        });
      } else {
        set({ site: { ...state.site, userId: uid } });
      }
    });
  });
  return () => {
    try {
      unsubscribe();
    } catch {}
  };
}
