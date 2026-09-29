/**
 * /admin/ client (src/pages/admin/index.astro): the moderation inbox.
 *
 * - Remembers the owner in this browser (`setOwnerFlag`) when the Access
 *   check passed, so the canvas and note pages show the in-place review tools
 *   and 整理贴纸; forgets it when the check failed.
 * - Replaces the slugs on the cards with note titles from /llms.txt (a static
 *   file; the Worker does not bundle the content collection). Slugs stay when
 *   it cannot be read.
 * - 直接拒绝 for obvious spam: two clicks (the first arms the button), POST
 *   /api/admin/decide, then the counts, 从第一条开始 and the empty state
 *   follow the cards that are still pending.
 *
 * - 恢复 on a hidden built-in sticker: POST /api/builtins {key, hidden:
 *   false}; the card goes, and this browser's canvas stops hiding it at once
 *   (noteBuiltinChange; others see it within 5 minutes).
 *
 * Approving, replying and everything else happen on the note page or canvas
 * the card links to (src/scripts/interact/review-*.ts).
 */
import type {
  BuiltinToggleResponse,
  DecideResponse,
  ReviewLink,
} from "@/lib/server/types";
import { noteBuiltinChange } from "@/scripts/interact/builtin-hidden-store";
import { clearOwnerFlag, setOwnerFlag } from "@/scripts/interact/owner";

/** How long an armed 直接拒绝 waits for the confirming click. */
const ARM_MS = 4000;
/** `- [Title](https://…/notes/<slug>.md): description` lines of /llms.txt. */
const NOTE_LINE =
  /^- \[(?<title>.+?)\]\([^)\s]*\/notes\/(?<slug>[^/)\s]+)\.md\)/gm;

type DecideReply = Partial<DecideResponse> & { error?: string };

const markOwner = () => {
  if (document.body.dataset.owner === undefined) {
    clearOwnerFlag();
  } else {
    setOwnerFlag();
  }
};

const noteTitles = (text: string) => {
  const titles = new Map<string, string>();
  for (const match of text.matchAll(NOTE_LINE)) {
    const { title, slug } = match.groups ?? {};
    if (title && slug) {
      titles.set(slug, title);
    }
  }
  return titles;
};

const fillTitles = async () => {
  const slots = document.querySelectorAll<HTMLElement>("[data-note-title]");
  if (slots.length === 0) {
    return;
  }
  try {
    const response = await fetch("/llms.txt");
    if (!response.ok) {
      return;
    }
    const titles = noteTitles(await response.text());
    for (const slot of slots) {
      const title = titles.get(slot.dataset.noteTitle ?? "");
      if (title) {
        slot.textContent = title;
      }
    }
  } catch {
    // Offline or blocked: the slugs stay.
  }
};

const pendingCards = () =>
  document.querySelectorAll<HTMLElement>("[data-card][data-pending]");

/**
 * Counts, 从第一条开始 and 都审完了 after a card left the queue. `next` is
 * the server's oldest pending item (it also sees past the listed batch);
 * without it, the first pending card on the page.
 */
const syncInbox = (card: HTMLElement, next: ReviewLink | null | undefined) => {
  const counter = document.querySelector<HTMLElement>(
    `[data-count="${card.dataset.kind ?? ""}"]`
  );
  if (counter) {
    const left = Math.max(0, Number(counter.textContent) - 1);
    counter.textContent = String(left);
  }
  const nextHref =
    next === undefined
      ? pendingCards()[0]?.querySelector<HTMLAnchorElement>("[data-go]")?.href
      : next?.href;
  const start = document.querySelector<HTMLAnchorElement>("[data-start]");
  if (start && nextHref) {
    start.href = nextHref;
  }
  if (!nextHref) {
    start?.setAttribute("hidden", "");
    document.querySelector("[data-all-done]")?.removeAttribute("hidden");
  }
};

const setStatus = (card: HTMLElement, text: string) => {
  const status = card.querySelector<HTMLElement>("[data-status]");
  if (status) {
    status.textContent = text;
  }
};

const disarm = (button: HTMLButtonElement) => {
  button.removeAttribute("data-armed");
  button.textContent = "直接拒绝";
};

const arm = (card: HTMLElement, button: HTMLButtonElement) => {
  button.dataset.armed = "";
  button.textContent = "确定拒绝";
  setStatus(
    card,
    card.dataset.kind === "sticker"
      ? "再点一次拒绝，图片会删掉，没法恢复"
      : "再点一次拒绝"
  );
  window.setTimeout(() => {
    if (button.dataset.armed !== undefined && !button.disabled) {
      disarm(button);
      setStatus(card, "");
    }
  }, ARM_MS);
};

const reject = async (card: HTMLElement, button: HTMLButtonElement) => {
  button.disabled = true;
  setStatus(card, "正在拒绝……");
  try {
    const response = await fetch("/api/admin/decide", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        type: card.dataset.type,
        id: card.dataset.id,
        decision: "reject",
      }),
    });
    const data = (await response.json().catch(() => ({}))) as DecideReply;
    if (!response.ok) {
      throw new Error(data.error ?? `没拒绝成功（${response.status}）`);
    }
    card.removeAttribute("data-pending");
    card.classList.add("is-decided");
    button.remove();
    setStatus(card, "已拒绝");
    syncInbox(card, data.next);
  } catch (error) {
    button.disabled = false;
    disarm(button);
    setStatus(card, error instanceof Error ? error.message : "没拒绝成功");
  }
};

type RestoreReply = Partial<BuiltinToggleResponse> & { error?: string };

/** The list of hidden built-ins after one came back. */
const syncBuiltins = () => {
  const left = document.querySelectorAll("[data-builtin]").length;
  const count = document.querySelector("[data-builtin-count]");
  if (count) {
    count.textContent = String(left);
  }
  if (left === 0) {
    document.querySelector("[data-builtins-empty]")?.removeAttribute("hidden");
  }
};

const restoreBuiltin = async (card: HTMLElement, button: HTMLButtonElement) => {
  const key = button.dataset.restore ?? "";
  button.disabled = true;
  setStatus(card, "正在恢复……");
  try {
    const response = await fetch("/api/builtins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, hidden: false }),
    });
    const data = (await response.json().catch(() => ({}))) as RestoreReply;
    if (!response.ok) {
      throw new Error(data.error ?? `没恢复成功（${response.status}）`);
    }
    noteBuiltinChange(key, false);
    // Focus would be lost with the card: keep it in the section.
    const heading = document.querySelector<HTMLElement>("#h-builtins");
    card.remove();
    syncBuiltins();
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  } catch (error) {
    button.disabled = false;
    setStatus(card, error instanceof Error ? error.message : "没恢复成功");
  }
};

const onRestoreClick = (event: MouseEvent) => {
  const button =
    event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-restore]")
      : null;
  const card = button?.closest<HTMLElement>("[data-builtin]");
  if (button && card && !button.disabled) {
    restoreBuiltin(card, button);
  }
};

const onClick = (event: MouseEvent) => {
  const button =
    event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>("button[data-reject]")
      : null;
  const card = button?.closest<HTMLElement>("[data-card]");
  if (!(button && card) || button.disabled) {
    return;
  }
  if (button.dataset.armed === undefined) {
    arm(card, button);
  } else {
    reject(card, button);
  }
};

markOwner();
fillTitles();
document.addEventListener("click", onClick);
document.addEventListener("click", onRestoreClick);
