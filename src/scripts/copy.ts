/**
 * Copy buttons: `<button type="button" data-copy="text" data-copy-status="id">`
 * copies `text` and writes 已复制 into the element with that id, which must
 * be a `role="status"` region already in the page (so screen readers
 * announce it). The message clears after a moment.
 *
 * One listener on the document, added once: it keeps working when the
 * router swaps the drawer or the page (note copyright slips, /links/).
 */
const CLEAR_MS = 2400;
const COPIED = "已复制";
const FAILED = "没复制成功，请手动选中复制";

const timers = new WeakMap<HTMLElement, number>();

const say = (status: HTMLElement, message: string) => {
  clearTimeout(timers.get(status));
  // Clear first so the same message is announced again on a second click.
  status.textContent = "";
  requestAnimationFrame(() => {
    status.textContent = message;
  });
  timers.set(
    status,
    window.setTimeout(() => {
      status.textContent = "";
    }, CLEAR_MS)
  );
};

const copy = async (button: HTMLButtonElement) => {
  const text = button.dataset.copy ?? "";
  const statusId = button.dataset.copyStatus;
  const status = statusId ? document.getElementById(statusId) : null;
  try {
    await navigator.clipboard.writeText(text);
    if (status) {
      say(status, COPIED);
    }
  } catch {
    if (status) {
      say(status, FAILED);
    }
  }
};

const onClick = (event: MouseEvent) => {
  const target = event.target instanceof Element ? event.target : null;
  const button = target?.closest<HTMLButtonElement>("button[data-copy]");
  if (button) {
    copy(button).catch(() => {
      // copy() reports its own failures in the status region.
    });
  }
};

const FLAG = "copyButtons";
if (!document.documentElement.dataset[FLAG]) {
  document.documentElement.dataset[FLAG] = "on";
  document.addEventListener("click", onClick);
}
