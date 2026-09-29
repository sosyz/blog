/**
 * The toolbar avatar (AuthMenu.astro): shown only while logged in with
 * GitHub; opens a small note with 登录为 <login> and 退出登录. The toolbar is
 * replaced on every ClientRouter navigation, so setup runs per element on
 * `astro:page-load`; the login state itself is asked once per full page
 * load (auth.ts) and pushed here again after 退出.
 */
import { type AuthState, avatarSrc, bindLogout, subscribe } from "./auth";

/** Avatar size requested from GitHub (shown at 26px). */
const AVATAR_PX = 64;

const setup = (host: HTMLElement) => {
  host.dataset.ready = "";
  const button = host.querySelector<HTMLButtonElement>("[data-auth-me]");
  const pop = host.querySelector<HTMLElement>("[data-auth-pop]");
  if (!(button && pop)) {
    return;
  }
  const open = (yes: boolean) => {
    pop.hidden = !yes;
    button.setAttribute("aria-expanded", String(yes));
  };
  button.addEventListener("click", () => open(Boolean(pop.hidden)));
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && !pop.hidden) {
      // Keep the drawer open (canvas.ts skips Esc that was handled).
      event.preventDefault();
      open(false);
      button.focus();
    }
  };
  const onPointer = (event: PointerEvent) => {
    if (!(pop.hidden || host.contains(event.target as Node | null))) {
      open(false);
    }
  };
  // The avatar is gone after 退出: move focus to the search box.
  bindLogout(pop, () => {
    document
      .querySelector<HTMLElement>(".toolbar [data-search]")
      ?.focus({ preventScroll: true });
  });

  const show = ({ user }: AuthState) => {
    if (!user) {
      open(false);
      host.hidden = true;
      return;
    }
    const avatar = host.querySelector<HTMLImageElement>("[data-auth-avatar]");
    if (avatar) {
      avatar.src = avatarSrc(user.avatarUrl, AVATAR_PX);
    }
    for (const el of host.querySelectorAll<HTMLElement>("[data-auth-login]")) {
      el.textContent = user.login;
    }
    const label = host.querySelector<HTMLElement>("[data-auth-label]");
    if (label) {
      label.textContent = `已用 GitHub 登录：${user.login}，打开菜单`;
    }
    button.title = `已登录：${user.login}`;
    host.hidden = false;
  };
  const unsubscribe = subscribe(show);
  document.addEventListener("keydown", onKey);
  document.addEventListener("pointerdown", onPointer, true);
  document.addEventListener(
    "astro:before-swap",
    () => {
      unsubscribe();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer, true);
    },
    { once: true }
  );
};

const init = () => {
  for (const host of document.querySelectorAll<HTMLElement>(
    "[data-auth-menu]:not([data-ready])"
  )) {
    setup(host);
  }
};

document.addEventListener("astro:page-load", init);
init();
