/**
 * Pieces of a comment slip as HTML strings (comments.ts, inline.ts): the
 * commenter's name, the avatar circle and the 博主 stamp. Pure, so they are
 * unit-tested (tests/interact-auth.test.ts).
 */
import type { PublicUser } from "@/lib/server/types";
import { avatarSrc } from "./auth";
import { esc, INKS, initial, pick } from "./util";

/** Avatar size requested from GitHub (shown at 36px, sharp on 2× screens). */
const AVATAR_PX = 64;

/** A nickname, linked to the commenter's site when there is one. */
export const nameHtml = (name: string, site: string | null) =>
  site
    ? `<a href="${esc(site)}" rel="nofollow ugc noopener" target="_blank">${esc(name)}</a>`
    : esc(name);

/** GitHub commenters: display name (or login) linking to the profile, + @login. */
export const userNameHtml = (user: PublicUser) => {
  const shown = user.name || user.login;
  const login =
    shown === user.login
      ? ""
      : ` <span class="cmt-login">@${esc(user.login)}</span>`;
  return `${nameHtml(shown, user.htmlUrl)}${login}`;
};

/** The name shown for a comment: GitHub profile or the nickname + site. */
export const commenterHtml = (item: {
  name: string;
  site: string | null;
  user?: PublicUser | null;
}) => (item.user ? userNameHtml(item.user) : nameHtml(item.name, item.site));

/** The circle: GitHub avatar when logged in, else the inked initial. */
export const avatarHtml = (item: {
  name: string;
  user?: PublicUser | null;
}) => {
  if (item.user) {
    return `<span class="cmt-av has-img" aria-hidden="true"><img src="${esc(avatarSrc(item.user.avatarUrl, AVATAR_PX))}" alt="" width="36" height="36" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></span>`;
  }
  const ink = pick(INKS, item.name) ?? "var(--pencil)";
  return `<span class="cmt-av" style="--c: ${ink}" aria-hidden="true">${esc(initial(item.name))}</span>`;
};

/** The owner's comments (GitHub session only): a small red 博主 stamp. */
export const ownerStampHtml = (item: {
  user?: PublicUser | null;
  isOwner?: boolean;
}) =>
  item.user && item.isOwner
    ? '<span class="stamp is-mini cmt-boss">博主</span>'
    : "";
