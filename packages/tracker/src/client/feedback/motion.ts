import { useSyncExternalStore } from "react";

/**
 * Motion that CSS cannot express by itself: an icon that settles after its
 * value changes, a row that fades out after the data already dropped it, a
 * theme that spreads from where it was chosen. All of it is decorative and
 * runs after the change has happened; none of it runs under reduced motion.
 */
const reduceQuery = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion() {
  return (
    typeof matchMedia === "function" &&
    globalThis.matchMedia(reduceQuery).matches
  );
}

function subscribeReducedMotion(listener: () => void) {
  const query = globalThis.matchMedia(reduceQuery);
  query.addEventListener("change", listener);
  return () => {
    query.removeEventListener("change", listener);
  };
}

export function useReducedMotion() {
  return useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion);
}

const supportsViewTransitions = "startViewTransition" in document;

/** Same-document view transitions, where the browser has them and motion is welcome. */
export function useViewTransitions() {
  const reduced = useReducedMotion();
  return !reduced && supportsViewTransitions;
}

/** `--ease-out` and `--ease-spring` from tokens.css, for script animations. */
export const easeOut = "cubic-bezier(.2, .8, .2, 1)";
export const spring =
  "linear(0, 0.06 4.5%, 0.24 9.5%, 0.52 15.5%, 0.79 22%, 0.96 28.5%, 1.04 35%, 1.06 41%, 1.05 48%, 1.02 57%, 1 66%, 0.995 76%, 1)";

/** After the browser has painted what React rendered for a change. */
function afterPaint(run: () => void) {
  requestAnimationFrame(() => {
    requestAnimationFrame(run);
  });
}

const escape = (value: string) => CSS.escape(value);

/**
 * A status icon that just changed settles into place; a completed one draws
 * its check. Rows, cards and the open issue's property all show it.
 */
export function settleStatus(identifiers: readonly string[]) {
  if (prefersReducedMotion()) {
    return;
  }
  afterPaint(() => {
    for (const identifier of identifiers) {
      const id = escape(identifier);
      // The customizable select shows its value in <selectedcontent>; the
      // Base UI fallback shows it in the trigger itself.
      const pickers = [
        `.picker[data-picker="state"][data-issue="${id}"]`,
        `[data-detail-issue="${id}"] #property-state`,
        `[data-sub-issue="${id}"] .picker`,
      ];
      const icons = document.querySelectorAll<SVGElement>(
        pickers
          .flatMap((picker) => [
            `${picker} selectedcontent > .option-icon > .state-icon`,
            `${picker}:not(select) > .option-icon > .state-icon`,
          ])
          .join(","),
      );
      for (const icon of icons) {
        icon.animate(
          [
            { transform: "scale(.55) rotate(-80deg)", opacity: 0.4 },
            { transform: "scale(1.14) rotate(6deg)", opacity: 1, offset: 0.6 },
            { transform: "none", opacity: 1 },
          ],
          { duration: 260, easing: easeOut },
        );
        icon
          .querySelector("[data-check]")
          ?.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
            duration: 220,
            delay: 80,
            easing: easeOut,
            fill: "backwards",
          });
      }
    }
  });
}

let layoutTimer: ReturnType<typeof setTimeout> | undefined;
let stillRequests = 0;

/**
 * Keep rows from gliding while a list restores its scroll position: the
 * restore corrects the scroll frame by frame against where rows are, and a
 * row still gliding would move under it. Returns the release.
 */
export function holdRowsStill() {
  stillRequests += 1;
  clearTimeout(layoutTimer);
  delete document.documentElement.dataset["listMotion"];
  let released = false;
  return () => {
    if (!released) {
      released = true;
      stillRequests -= 1;
    }
  };
}

/**
 * For a moment, let list rows glide to their new places, as they do when a
 * row above them leaves or a group opens. Scrolling never animates them.
 */
export function glideRows() {
  if (prefersReducedMotion() || stillRequests > 0) {
    return;
  }
  document.documentElement.dataset["listMotion"] = "";
  clearTimeout(layoutTimer);
  layoutTimer = setTimeout(() => {
    delete document.documentElement.dataset["listMotion"];
  }, 320);
}

/** A cancelled animation rejects `finished`; the node goes either way. */
async function removeAfter(animation: Animation, node: Element) {
  try {
    await animation.finished;
  } catch {
    // Cancelled because the row stayed.
  } finally {
    node.remove();
  }
}

/**
 * Rows and cards of these issues fade out where they were. The data layer
 * removes them at once; a copy that nothing can reach stays behind for the
 * fade. When the row is still there a moment later (archived issues shown),
 * the copy goes at once.
 */
export function leave(identifiers: readonly string[]) {
  if (prefersReducedMotion()) {
    return;
  }
  glideRows();
  for (const identifier of identifiers) {
    const id = escape(identifier);
    for (const element of document.querySelectorAll<HTMLElement>(
      `.issue-row[data-row-issue="${id}"], .board-card[data-row-issue="${id}"]`,
    )) {
      const rect = element.getBoundingClientRect();
      const ghost = element.cloneNode(true);
      if (!(ghost instanceof HTMLElement)) {
        continue;
      }
      for (const node of [ghost, ...ghost.querySelectorAll("*")]) {
        for (const name of [
          "id",
          "data-row-issue",
          "data-issue-row",
          "data-issue",
          "data-picker",
        ]) {
          node.removeAttribute(name);
        }
      }
      ghost.inert = true;
      ghost.setAttribute("aria-hidden", "true");
      ghost.classList.add("leaving");
      Object.assign(ghost.style, {
        position: "absolute",
        top: `${String(rect.top + globalThis.scrollY)}px`,
        left: `${String(rect.left + globalThis.scrollX)}px`,
        width: `${String(rect.width)}px`,
        height: `${String(rect.height)}px`,
        margin: "0",
        transform: "none",
      });
      document.body.append(ghost);
      const fade = ghost.animate(
        [
          { opacity: 1, transform: "none" },
          { opacity: 0, transform: "translateX(-10px) scale(.985)" },
        ],
        { duration: 200, easing: easeOut, fill: "forwards" },
      );
      void removeAfter(fade, ghost);
      afterPaint(() => {
        if (element.isConnected) {
          fade.cancel();
        }
      });
    }
  }
}

/** The new theme's snapshot grows as a circle from the chosen point. */
async function spread(transition: ViewTransition, x: number, y: number) {
  const root = document.documentElement;
  const radius = Math.hypot(
    Math.max(x, globalThis.innerWidth - x),
    Math.max(y, globalThis.innerHeight - y),
  );
  try {
    await transition.ready;
    root.animate(
      {
        clipPath: [
          `circle(0px at ${String(x)}px ${String(y)}px)`,
          `circle(${String(radius)}px at ${String(x)}px ${String(y)}px)`,
        ],
      },
      {
        duration: 420,
        easing: easeOut,
        pseudoElement: "::view-transition-new(root)",
      },
    );
    await transition.finished;
  } catch {
    // Skipped transitions still applied the theme.
  } finally {
    delete root.dataset["themeReveal"];
  }
}

/**
 * Switch the theme with the new one spreading as a circle from `origin`.
 * Without view transitions, or under reduced motion, it switches at once.
 */
export function revealTheme(
  apply: () => void,
  origin: { x: number; y: number },
) {
  if (!supportsViewTransitions || prefersReducedMotion()) {
    apply();
    return;
  }
  document.documentElement.dataset["themeReveal"] = "";
  void spread(document.startViewTransition(apply), origin.x, origin.y);
}

/** Where a click happened, or the middle of the element a key pressed. */
export function originOf(event: {
  clientX: number;
  clientY: number;
  detail: number;
  currentTarget: Element;
}) {
  if (event.detail > 0) {
    return { x: event.clientX, y: event.clientY };
  }
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Let the items of a list glide from where they were to where the next
 * render puts them, as when a saved view is moved. Their places are taken
 * now; the move is measured as soon as the list's children change, before
 * the browser paints them.
 */
export function flipItems(list: string, item: string, key: string) {
  const container = document.querySelector(list);
  if (container === null || prefersReducedMotion()) {
    return;
  }
  const keyOf = (element: HTMLElement) => element.dataset[key];
  const before = new Map<string, number>();
  for (const element of container.querySelectorAll<HTMLElement>(item)) {
    const id = keyOf(element);
    if (id !== undefined) {
      before.set(id, element.getBoundingClientRect().top);
    }
  }
  const observer = new MutationObserver(() => {
    observer.disconnect();
    for (const element of container.querySelectorAll<HTMLElement>(item)) {
      const id = keyOf(element);
      const top = id === undefined ? undefined : before.get(id);
      const shift =
        top === undefined ? 0 : top - element.getBoundingClientRect().top;
      if (shift !== 0) {
        element.animate(
          [{ translate: `0 ${String(shift)}px` }, { translate: "0 0" }],
          { duration: 180, easing: easeOut },
        );
      }
    }
  });
  observer.observe(container, { childList: true, subtree: true });
  setTimeout(() => {
    observer.disconnect();
  }, 1000);
}
