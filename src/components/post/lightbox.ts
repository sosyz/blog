/*
 * Click a polaroid photo in the article to see it large (docs/design.md,
 * 图片查看). The photo grows from where it sits into a centred polaroid with
 * a strip of tape and its alt text as a hand-written caption, and shrinks
 * back on close. Reduced motion shows and hides it without the zoom.
 *
 * The overlay is a modal <dialog> (showModal): the page behind it is inert,
 * so Tab stays on the photo and its 关闭 button.
 *
 * Listeners are delegated on `document`, so they survive drawer swaps.
 * Esc is caught in the capture phase and marked handled, so the drawer's own
 * Esc handler (which skips handled events) leaves the note open.
 */
import { onDrawerRendered, prefersReducedMotion } from "@/scripts/canvas/api";

const PHOTO = ".post-body p.pic img";
const OPEN_MS = 320;
const CLOSE_MS = 240;

interface Open {
  overlay: HTMLDialogElement;
  source: HTMLImageElement;
}
let open: Open | null = null;

const flipFrom = (from: DOMRect, to: DOMRect) => {
  const scale = from.width / to.width;
  const dx = from.left + from.width / 2 - (to.left + to.width / 2);
  const dy = from.top + from.height / 2 - (to.top + to.height / 2);
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
};

const close = (instant = false) => {
  if (!open) {
    return;
  }
  const { overlay, source } = open;
  open = null;
  const done = () => {
    overlay.close();
    overlay.remove();
    source.focus({ preventScroll: true });
  };
  const figure = overlay.querySelector("figure");
  const big = overlay.querySelector<HTMLImageElement>("figure img");
  if (instant || prefersReducedMotion() || !figure || !big) {
    done();
    return;
  }
  overlay.classList.remove("is-open");
  figure
    .animate(
      [
        { transform: "none" },
        {
          transform: flipFrom(
            source.getBoundingClientRect(),
            big.getBoundingClientRect()
          ),
        },
      ],
      {
        duration: CLOSE_MS,
        easing: "cubic-bezier(0.4, 0, 0.6, 1)",
        fill: "forwards",
      }
    )
    .finished.then(done, done);
};

const show = (source: HTMLImageElement) => {
  close(true);
  const overlay = document.createElement("dialog");
  overlay.className = "lightbox";
  overlay.setAttribute("aria-label", source.alt || "查看大图");

  const figure = document.createElement("figure");
  const tape = document.createElement("img");
  tape.className = "lightbox-tape";
  tape.src = "/journal/tape/masking-cream.webp";
  tape.alt = "";
  const big = document.createElement("img");
  big.src = source.currentSrc || source.src;
  big.alt = source.alt;
  const caption = document.createElement("figcaption");
  caption.textContent = source.alt;
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "lightbox-close";
  closeButton.setAttribute("aria-label", "关闭大图");
  closeButton.textContent = "×";
  for (const child of [tape, big, caption, closeButton]) {
    figure.appendChild(child);
  }
  overlay.appendChild(figure);
  document.body.appendChild(overlay);
  overlay.showModal();
  open = { overlay, source };

  // Esc on a modal dialog: close with the animation, not instantly.
  overlay.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });

  overlay.addEventListener("click", (event) => {
    const target = event.target as Element;
    if (target === overlay || target.closest(".lightbox-close")) {
      close();
    }
  });

  const reveal = () => {
    if (!prefersReducedMotion()) {
      figure.animate(
        [
          {
            transform: flipFrom(
              source.getBoundingClientRect(),
              big.getBoundingClientRect()
            ),
          },
          { transform: "none" },
        ],
        { duration: OPEN_MS, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" }
      );
    }
    requestAnimationFrame(() => overlay.classList.add("is-open"));
  };
  if (big.complete) {
    reveal();
  } else {
    big.addEventListener("load", reveal, { once: true });
  }
  closeButton.focus({ preventScroll: true });
};

const photoFrom = (target: EventTarget | null) =>
  target instanceof Element ? target.closest<HTMLImageElement>(PHOTO) : null;

document.addEventListener("click", (event) => {
  const photo = photoFrom(event.target);
  if (photo) {
    event.preventDefault();
    show(photo);
  }
});

document.addEventListener(
  "keydown",
  (event) => {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    const photo = photoFrom(event.target);
    if (photo && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      show(photo);
    }
  },
  { capture: true }
);

/* Photos become keyboard-reachable buttons once the body is on the page. */
const prepare = () => {
  for (const photo of document.querySelectorAll<HTMLImageElement>(PHOTO)) {
    photo.tabIndex = 0;
    photo.setAttribute("role", "button");
    photo.setAttribute("aria-label", `查看大图：${photo.alt || "图片"}`);
  }
};

onDrawerRendered(prepare);
document.addEventListener("astro:page-load", () => {
  close(true);
  prepare();
});
