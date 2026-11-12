/**
 * Vibration where the browser offers it: Chromium on Android. Desktop
 * browsers have no motor and iOS Safari exposes no Vibration API, so there
 * this does nothing.
 */
export const canVibrate =
  typeof navigator !== "undefined" && typeof navigator.vibrate === "function";

export function vibrate(pattern: number | readonly number[]) {
  if (canVibrate) {
    navigator.vibrate(typeof pattern === "number" ? pattern : [...pattern]);
  }
}
