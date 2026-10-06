/**
 * Copy buttons, two kinds:
 * - `<button type="button" data-copy="text" data-copy-status="id">` copies
 *   `text` and writes 已复制 into the element with that id, which must be a
 *   `role="status"` region already in the page (so screen readers announce
 *   it). Note copyright slips, /links/.
 * - `<button type="button" class="slip-copy">` on a code slip (codeSlips in
 *   src/lib/markdown/plugins.ts) copies that slip's code and writes into the
 *   slip's own `.slip-said` status region.
 * The message clears after a moment.
 *
 * One listener on the document, added once: it keeps working when the
 * router swaps the drawer or the page.
 */
const CLEAR_MS = 2400;
const COPIED = "已复制";
const FAILED = "没复制成功，请手动选中复制";
const BUTTONS = "button[data-copy], button.slip-copy";

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

/**
 * The code on a slip, line by line from the DOM rather than innerText: it
 * works while a folded slip is closed, and lines marked `// [!code --]` are
 * left out, so the reader gets the code after the change. The + / − marks
 * and line numbers are CSS, so they are never in the text.
 */
const slipCode = (slip: Element) => {
  const code = slip.querySelector("pre code") ?? slip.querySelector("pre");
  if (!code) {
    return "";
  }
  const lines = code.querySelectorAll(".line");
  if (lines.length === 0) {
    return code.textContent ?? "";
  }
  const kept: string[] = [];
  for (const line of lines) {
    if (!line.classList.contains("remove")) {
      kept.push(line.textContent ?? "");
    }
  }
  return kept.join("\n");
};

/** What to copy and where to say so, for either kind of button. */
const targetOf = (button: HTMLButtonElement) => {
  const slip = button.classList.contains("slip-copy")
    ? button.closest(".slip")
    : null;
  if (slip) {
    return {
      status: slip.querySelector<HTMLElement>(".slip-said"),
      text: slipCode(slip),
    };
  }
  const statusId = button.dataset.copyStatus;
  return {
    status: statusId ? document.getElementById(statusId) : null,
    text: button.dataset.copy ?? "",
  };
};

const copy = async (button: HTMLButtonElement) => {
  const { text, status } = targetOf(button);
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
  const button = target?.closest<HTMLButtonElement>(BUTTONS);
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
