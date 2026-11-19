import { useSyncExternalStore } from "react";
import { feedbackPreferences } from "./preferences.ts";

/**
 * Calm motion helpers: theme reveals and full-page view transitions, gated by
 * both `prefers-reduced-motion` and the in-app Motion preference. Interactive
 * controls and virtualized rows stay stationary so targets never move under
 * the pointer.
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

export function useMotionDisabled() {
  const reduced = useReducedMotion();
  const motionOn = useSyncExternalStore(feedbackPreferences.subscribe, () =>
    feedbackPreferences.read("motion"),
  );
  return reduced || !motionOn;
}

const supportsViewTransitions =
  typeof document !== "undefined" && "startViewTransition" in document;

/** Same-document view transitions, where the browser has them and motion is enabled. */
export function useViewTransitions() {
  const disabled = useMotionDisabled();
  return !disabled && supportsViewTransitions;
}

/** `--ease-out` from tokens.css, for script animations. */
export const easeOut = "cubic-bezier(.2, .8, .2, 1)";

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
        duration: 240,
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
 * Without view transitions, or when motion is off, it switches at once.
 */
export function revealTheme(
  apply: () => void,
  origin: { x: number; y: number },
) {
  if (
    !supportsViewTransitions ||
    prefersReducedMotion() ||
    !feedbackPreferences.read("motion")
  ) {
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
