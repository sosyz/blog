/**
 * The comment section in the drawer (Comments.astro): renders the list from
 * the shared store and sends the form.
 *
 * The drawer is replaced on every ClientRouter navigation, so setup runs on
 * `astro:page-load` (and once right away) for every `[data-comments]` that
 * is not set up yet.
 *
 * The owner (Access session, review-comments.ts) sees more, visitors see
 * nothing new: pending comments at their place in time with a review bar
 * (通过 / 回复…), owner tools on approved ones (回复 / 改回复 / 删回复), a
 * folded 已撤下 list with 恢复, and the `?review=c:<id>` deep link scrolled
 * to, highlighted and focused once the drawer has settled. Rejecting a
 * pending comment and taking an approved one down (撤下) is dragging its
 * card into the trash, or Delete on the focused card (comment-drag.ts); a
 * thrown card is left out of the list until 撤销 runs out (isThrown).
 */
import type { PublicComment } from "@/lib/server/types";
import { rot } from "@/scripts/canvas/seed";
import { announce, sentMessage } from "./announce";
import {
  type AuthState,
  authBarHtml,
  bindLogout,
  currentPath,
  getAuth,
  subscribe as subscribeAuth,
} from "./auth";
import { watchThrows } from "./comment-drag";
import { avatarHtml, commenterHtml, ownerStampHtml } from "./comment-view";
import { JUMP_EVENT, type JumpDetail } from "./events";
import { reviewTarget } from "./owner";
import {
  barOf,
  focusKey,
  isThrown,
  keepFocus,
  onReviewClick,
  onReviewInput,
  pulse,
  REVIEW_FOCUS,
  type ReviewFocusDetail,
  type ReviewView,
  reviewNow,
  settle,
  watchReview,
} from "./review-comments";
import {
  canThrowRow,
  matchTarget,
  mergeRows,
  nextHtml,
  ownerToolsHtml,
  type Row,
  restoreBarHtml,
  reviewBarHtml,
  throwHintId,
  visitorRows,
  whoHtml,
} from "./review-state";
import {
  loadThread,
  submitComment,
  subscribe,
  type Thread,
  threadNow,
} from "./store";
import { mountTurnstile, type TurnstileHandle } from "./turnstile";
import { dotDate, esc, readProfile, saveProfile, scrollBehavior } from "./util";

const BODY_MAX = 800;
const DENIED_HTML =
  '需要先在 <a href="/admin/">/admin/</a> 登录，才能在这里审核留言。';
/** Comment slips tilt within ±0.6°. */
const SLIP_TILT = 1.2;

const quoteHtml = (exact: string) =>
  `<p class="cmt-quote"><button type="button" data-jump="${esc(exact)}" title="回到正文里这段话">「${esc(exact)}」</button></p>`;

const replyHtml = (reply: PublicComment["reply"]) =>
  reply
    ? `<div class="cmt-owner sticky-paper"><img class="sticker" src="/stickers/people-dog.webp" alt="" /><b>Sonui 回复</b>${esc(reply.body)}</div>`
    : "";

const shownNameOf = (item: Row["item"]) =>
  item.user ? item.user.name || item.user.login : item.name;

/** Below the body: 审核中 / review bar / owner tools / visitor 回复. */
const tailHtml = (row: Row, owner: boolean) => {
  const { item } = row;
  switch (row.kind) {
    case "own":
      return '<span class="pend-stamp">审核中</span>';
    case "review":
      return `<span class="pend-stamp rv-stamp">待审</span>${replyHtml(row.item.reply)}${reviewBarHtml(item.id, barOf(item.id))}`;
    case "hidden":
      return `<span class="pend-stamp rv-stamp">已撤下</span>${replyHtml(row.item.reply)}${restoreBarHtml(item.id, barOf(item.id))}`;
    case "approved":
      return owner
        ? `${replyHtml(row.item.reply)}${ownerToolsHtml(row.item, barOf(item.id))}`
        : `<div class="cmt-actions"><button type="button" data-reply="${esc(item.id)}" data-reply-name="${esc(shownNameOf(item))}">回复</button></div>${replyHtml(row.item.reply)}`;
    default:
      return "";
  }
};

const ROW_CLASS: Record<Row["kind"], string> = {
  approved: "cmt",
  hidden: "cmt pending review is-hidden",
  own: "cmt pending",
  review: "cmt pending review",
};

interface RowContext {
  owner: boolean;
  targetId: string;
}

/**
 * The owner can throw 待审 and approved cards into the trash: focusable,
 * with Delete / Backspace, picked up by their paper (comment-drag.ts).
 */
const throwAttrs = (row: Row, owner: boolean) => {
  if (!canThrowRow(row.kind, owner)) {
    return "";
  }
  const id = esc(row.item.id);
  return ` tabindex="0" data-throw="${id}" data-key="${id}:card" aria-keyshortcuts="Delete Backspace" aria-describedby="${throwHintId(row.item.id)}"`;
};

const rowHtml = (row: Row, index: number, context: RowContext) => {
  const { item } = row;
  const target = item.id === context.targetId ? " rv-target" : "";
  const throwable = throwAttrs(row, context.owner);
  const who =
    row.kind === "review" || row.kind === "hidden" ? whoHtml(row.item) : "";
  return `<li class="${ROW_CLASS[row.kind]}${target}${throwable ? " is-throwable" : ""}" id="c-${esc(item.id)}" style="--r: ${rot(`${item.name}${index}`, SLIP_TILT)}deg"${throwable}>
    ${avatarHtml(item)}
    <div>
      ${ownerStampHtml(item)}
      <p class="cmt-meta"><span class="cmt-name">${commenterHtml(item)}</span><time class="date-stamp" datetime="${new Date(item.createdAt).toISOString()}">${dotDate(item.createdAt)}</time></p>
      ${who}
      ${item.anchor ? quoteHtml(item.anchor.exact) : ""}
      <p class="cmt-body">${esc(item.body)}</p>
      ${tailHtml(row, context.owner)}
    </div>
  </li>`;
};

/** Thrown into the trash and waiting for 撤销 to run out: left out. */
const shown = <T extends { id: string }>(items: T[]) =>
  items.filter((item) => !isThrown(item.id));

const rowsOf = (thread: Thread, review: ReviewView): Row[] =>
  review.on
    ? mergeRows(thread.approved, thread.pending, review.pending).filter(
        (row) => !isThrown(row.item.id)
      )
    : visitorRows(thread.approved, thread.pending);

interface Refs {
  count: HTMLElement;
  countdown: HTMLElement;
  deniedNote: HTMLElement | null;
  empty: HTMLElement;
  emptyText: HTMLElement;
  error: HTMLElement;
  form: HTMLFormElement;
  /** 已撤下 is unfolded. */
  hiddenOpen: boolean;
  hiddenSlot: HTMLElement | null;
  list: HTMLOListElement;
  /** Logged in with GitHub: no name fields, no Turnstile. */
  member: boolean;
  /** Owner review: 下一条待审, 已撤下, 需要先在 /admin/ 登录. */
  nextSlot: HTMLElement | null;
  parentInput: HTMLInputElement;
  replying: HTMLElement;
  replyingText: HTMLElement;
  section: HTMLElement;
  slug: string;
  /** Screen-reader confirmation after sending (role="status"). */
  status: HTMLElement;
  /** The `?review=` comment was handled (once per page). */
  targetDone: boolean;
  targetId: string;
  textarea: HTMLTextAreaElement;
}

const refsOf = (section: HTMLElement): Refs | null => {
  const q = <T extends Element>(selector: string) =>
    section.querySelector<T>(selector);
  const form = q<HTMLFormElement>("[data-cmt-form]");
  const list = q<HTMLOListElement>("[data-cmt-list]");
  const textarea = form?.querySelector<HTMLTextAreaElement>("textarea");
  const parentInput =
    form?.querySelector<HTMLInputElement>('[name="parentId"]');
  const parts = {
    count: q<HTMLElement>("[data-cmt-count]"),
    countdown: q<HTMLElement>("[data-cmt-countdown]"),
    empty: q<HTMLElement>("[data-cmt-empty]"),
    emptyText: q<HTMLElement>("[data-cmt-empty-text]"),
    error: q<HTMLElement>("[data-cmt-error]"),
    form,
    list,
    parentInput,
    replying: q<HTMLElement>("[data-cmt-replying]"),
    replyingText: q<HTMLElement>("[data-cmt-replying-text]"),
    status: q<HTMLElement>("[data-cmt-status]"),
    textarea,
  };
  for (const value of Object.values(parts)) {
    if (!value) {
      return null;
    }
  }
  return {
    deniedNote: q<HTMLElement>("[data-rv-note]"),
    hiddenOpen: false,
    hiddenSlot: q<HTMLElement>("[data-rv-hidden-slot]"),
    member: false,
    nextSlot: q<HTMLElement>("[data-rv-next-slot]"),
    section,
    slug: section.dataset.slug ?? "",
    targetDone: false,
    targetId: "",
    ...parts,
  } as Refs;
};

const countText = (approved: number, review: ReviewView) => {
  const parts = approved > 0 ? [`${approved} 条`] : [];
  const pending = shown(review.pending).length;
  if (review.on && pending > 0) {
    parts.push(`待审 ${pending}`);
  }
  return parts.join(" · ");
};

const emptyText = (thread: Thread) => {
  if (!thread.loaded) {
    return "正在翻留言……";
  }
  return thread.error
    ? `留言没加载出来：${thread.error}`
    : "还没有留言，来写第一条吧。";
};

/** 已撤下 N 条: folded list of rejected comments with 恢复. */
const renderHidden = (refs: Refs, review: ReviewView, context: RowContext) => {
  const slot = refs.hiddenSlot;
  if (!slot) {
    return;
  }
  const hidden = review.on ? review.hidden : [];
  slot.hidden = hidden.length === 0;
  slot.innerHTML =
    hidden.length === 0
      ? ""
      : `<details class="rv-hidden"${refs.hiddenOpen ? " open" : ""}>
      <summary data-key="rv-hidden-summary">已撤下 ${hidden.length} 条</summary>
      <ol class="cmt-list">${hidden
        .map((item, index) => rowHtml({ item, kind: "hidden" }, index, context))
        .join("")}</ol>
    </details>`;
};

const renderReviewBits = (refs: Refs, review: ReviewView) => {
  if (refs.nextSlot) {
    refs.nextSlot.innerHTML = review.next ? nextHtml(review.next) : "";
    refs.nextSlot.hidden = !review.next;
  }
  const note = refs.deniedNote;
  if (!note) {
    return;
  }
  const error = review.on ? review.error : null;
  if (review.denied) {
    note.innerHTML = DENIED_HTML;
  } else if (error) {
    note.textContent = `待审的留言没加载出来：${error}`;
  }
  note.hidden = !(review.denied || error);
};

const render = (refs: Refs) => {
  const thread = threadNow(refs.slug);
  const review = reviewNow(refs.slug);
  const rows = rowsOf(thread, review);
  const context: RowContext = { owner: review.on, targetId: refs.targetId };
  keepFocus(refs.section, () => {
    refs.count.textContent = countText(shown(thread.approved).length, review);
    refs.list.innerHTML = rows
      .map((row, index) => rowHtml(row, index, context))
      .join("");
    refs.list.hidden = rows.length === 0;
    refs.empty.hidden = rows.length > 0;
    refs.emptyText.textContent = emptyText(thread);
    renderHidden(refs, review, context);
    renderReviewBits(refs, review);
  });
  handleTarget(refs);
};

/* ---------- the ?review=c:<id> deep link ---------- */

/** Let inline.ts show a highlight comment at its text; false = not placed. */
const placedInline = (slug: string, id: string) => {
  const detail: ReviewFocusDetail = { id, slug };
  return !window.dispatchEvent(
    new CustomEvent(REVIEW_FOCUS, { cancelable: true, detail })
  );
};

const showTarget = async (refs: Refs, id: string) => {
  const hit = matchTarget(reviewTarget(), {
    approved: threadNow(refs.slug).approved,
    hidden: reviewNow(refs.slug).hidden,
    pending: reviewNow(refs.slug).pending,
  });
  if (!hit) {
    return;
  }
  refs.targetId = id;
  if (hit.list === "hidden") {
    refs.hiddenOpen = true;
  }
  render(refs);
  await settle(refs.section);
  if (!refs.section.isConnected) {
    return;
  }
  if (hit.list === "pending" && hit.inline && placedInline(refs.slug, id)) {
    return;
  }
  const row = refs.section.querySelector<HTMLElement>(`#c-${CSS.escape(id)}`);
  if (!row) {
    return;
  }
  row.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  pulse(row);
  const button = row.querySelector<HTMLElement>(
    `[data-key="${CSS.escape(`${id}:${hit.focus}`)}"]`
  );
  button?.focus({ preventScroll: true });
};

/** Once both lists are in: find the deep-linked comment (once per page). */
const handleTarget = (refs: Refs) => {
  if (refs.targetDone) {
    return;
  }
  const target = reviewTarget();
  const review = reviewNow(refs.slug);
  if (target?.type !== "comment" || review.denied) {
    refs.targetDone = true;
    return;
  }
  if (!(review.on && review.loaded && threadNow(refs.slug).loaded)) {
    return;
  }
  refs.targetDone = true;
  showTarget(refs, target.id);
};

const showError = (refs: Refs, message: string) => {
  refs.error.textContent = message;
  refs.error.hidden = !message;
};

const setReply = (refs: Refs, id: string, name: string) => {
  refs.parentInput.value = id;
  refs.replyingText.textContent = id ? `回复 ${name}` : "";
  refs.replying.hidden = !id;
  if (id && !refs.textarea.value.startsWith(`@${name}`)) {
    refs.textarea.value = `@${name} ${refs.textarea.value}`;
  }
  refs.textarea.dispatchEvent(new Event("input"));
};

const onListClick = (refs: Refs, event: MouseEvent) => {
  const target = event.target instanceof Element ? event.target : null;
  const reply = target?.closest<HTMLElement>("[data-reply]");
  if (reply) {
    setReply(refs, reply.dataset.reply ?? "", reply.dataset.replyName ?? "");
    refs.form.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    refs.textarea.focus({ preventScroll: true });
    return;
  }
  const jump = target?.closest<HTMLElement>("[data-jump]");
  if (jump) {
    const detail: JumpDetail = {
      exact: jump.dataset.jump ?? "",
      slug: refs.slug,
    };
    window.dispatchEvent(new CustomEvent(JUMP_EVENT, { detail }));
  }
};

const fillProfile = (form: HTMLFormElement) => {
  const profile = readProfile();
  for (const key of ["name", "email", "site"] as const) {
    const input = form.elements.namedItem(key);
    if (input instanceof HTMLInputElement && !input.value) {
      input.value = profile[key] ?? "";
    }
  }
};

const localProblem = (name: string, body: string, token: string | null) => {
  if (name === "") {
    return "写一下昵称吧。";
  }
  if (!body) {
    return "留言内容还是空的。";
  }
  if (token === "") {
    return "人机验证还没完成，稍等一下再寄出。";
  }
  return "";
};

/** Turnstile for one comment form: mounted lazily, only while logged out. */
interface Human {
  handle: TurnstileHandle | null;
  /** The form came near the viewport or got focus. */
  near: boolean;
}

const mountHuman = (refs: Refs, human: Human) => {
  const wrap = refs.form.querySelector<HTMLElement>("[data-turnstile]");
  if (wrap && !human.handle && !refs.member) {
    human.handle = mountTurnstile(wrap);
  }
  return human.handle;
};

const unmountHuman = (human: Human) => {
  human.handle?.remove();
  human.handle = null;
};

const onSubmit = async (
  refs: Refs,
  human: Human,
  submit: HTMLButtonElement
) => {
  const data = new FormData(refs.form);
  const field = (key: string) => String(data.get(key) ?? "").trim();
  const name = field("name");
  const body = field("body");
  const auth = refs.member ? await getAuth() : null;
  const user = auth?.user ?? null;
  const turnstile = user ? null : mountHuman(refs, human);
  const token = user ? null : (turnstile?.token() ?? "");
  const problem = localProblem(user ? "-" : name, body, token);
  showError(refs, problem);
  if (problem) {
    return;
  }
  submit.disabled = true;
  const common = {
    body,
    kind: "comment" as const,
    parentId: field("parentId") || undefined,
    slug: refs.slug,
  };
  const result = await submitComment(
    user
      ? common
      : {
          ...common,
          email: field("email") || undefined,
          name,
          site: field("site") || undefined,
          turnstile: token ?? "",
        },
    { isOwner: auth?.isOwner ?? false, user }
  );
  submit.disabled = false;
  turnstile?.reset();
  if (!result.ok) {
    showError(refs, result.message);
    return;
  }
  if (!user) {
    saveProfile({ email: field("email"), name, site: field("site") });
  }
  refs.textarea.value = "";
  setReply(refs, "", "");
  announce(sentMessage(result.data.status), refs.status);
  const mine = refs.list.querySelector<HTMLElement>(
    `#c-${CSS.escape(result.data.id)}`
  );
  mine?.classList.add("flash");
  mine?.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
};

/**
 * Load Turnstile only when the form is about to be used, and only for
 * visitors who are not logged in (a GitHub session stands in for it).
 */
const mountWhenNear = (refs: Refs, human: Human) => {
  const mount = () => {
    if (human.near) {
      return;
    }
    human.near = true;
    observer.disconnect();
    getAuth().then(() => {
      if (refs.form.isConnected) {
        mountHuman(refs, human);
      }
    });
  };
  const observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        mount();
      }
    },
    { rootMargin: "300px 0px" }
  );
  observer.observe(refs.form);
  refs.form.addEventListener("focusin", mount, { once: true });
};

/**
 * Shows the login bar. Logged in: hides the name fields and Turnstile and
 * shows 已登录，不用人机验证; logged out again: the reverse.
 */
const applyAuth = (refs: Refs, human: Human, state: AuthState) => {
  const slot = refs.form.querySelector<HTMLElement>("[data-auth-slot]");
  const html = authBarHtml(state, {
    next: currentPath("#comments"),
    verb: "留言",
  });
  if (slot) {
    slot.innerHTML = html;
    slot.hidden = !html;
    // After 退出 the button is gone: keep focus in the form.
    bindLogout(slot, () => {
      if (!refs.form.contains(document.activeElement)) {
        refs.textarea.focus({ preventScroll: true });
      }
    });
  }
  refs.member = Boolean(state.user);
  const fields = refs.form.querySelector<HTMLElement>("[data-cmt-fields]");
  const wrap = refs.form.querySelector<HTMLElement>("[data-turnstile]");
  const skip = refs.form.querySelector<HTMLElement>("[data-auth-skip]");
  for (const el of [fields, wrap]) {
    el?.toggleAttribute("hidden", refs.member);
  }
  skip?.toggleAttribute("hidden", !refs.member);
  if (refs.member) {
    unmountHuman(human);
    return;
  }
  fillProfile(refs.form);
  if (human.near) {
    mountHuman(refs, human);
  }
};

const setup = (section: HTMLElement) => {
  section.dataset.ready = "";
  const refs = refsOf(section);
  if (!refs?.slug) {
    return;
  }
  const human: Human = { handle: null, near: false };
  let seen: AuthState | null = null;
  const unsubscribeAuth = subscribeAuth((state) => {
    applyAuth(refs, human, state);
    // Logged out: that account's pending comments are no longer shown here.
    if (seen && seen.user?.login !== state.user?.login) {
      loadThread(refs.slug, true);
    }
    seen = state;
  });
  refs.textarea.addEventListener("input", () => {
    refs.countdown.textContent = `${[...refs.textarea.value].length} / ${BODY_MAX}`;
  });
  refs.list.addEventListener("click", (event) => onListClick(refs, event));
  section.addEventListener("click", (event) =>
    onReviewClick(refs.slug, section, event)
  );
  section.addEventListener("input", onReviewInput);
  // `toggle` does not bubble: listen while it comes down.
  section.addEventListener(
    "toggle",
    (event) => {
      if (event.target instanceof HTMLDetailsElement) {
        refs.hiddenOpen = event.target.open;
      }
    },
    true
  );
  section
    .querySelector("[data-cmt-reply-cancel]")
    ?.addEventListener("click", () => setReply(refs, "", ""));

  mountWhenNear(refs, human);
  const submit = refs.form.querySelector<HTMLButtonElement>(
    'button[type="submit"]'
  );
  refs.form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (submit) {
      onSubmit(refs, human, submit);
    }
  });

  const unsubscribe = subscribe(refs.slug, () => render(refs));
  const unwatch = watchReview(refs.slug, () => render(refs));
  const unwatchThrows = watchThrows({
    cardOf: (target) => target.closest<HTMLElement>("li.cmt[data-throw]"),
    findCard: (id) =>
      refs.list.querySelector<HTMLElement>(
        `li.cmt[data-throw="${CSS.escape(id)}"]`
      ),
    focusKeys: (keys) => focusKey(section, keys),
    root: refs.list,
    slug: refs.slug,
  });
  document.addEventListener(
    "astro:before-swap",
    () => {
      unsubscribe();
      unwatch();
      unwatchThrows();
      unsubscribeAuth();
      unmountHuman(human);
    },
    { once: true }
  );
  loadThread(refs.slug);
};

const init = () => {
  for (const section of document.querySelectorAll<HTMLElement>(
    "[data-comments]:not([data-ready])"
  )) {
    setup(section);
  }
};

document.addEventListener("astro:page-load", init);
init();
