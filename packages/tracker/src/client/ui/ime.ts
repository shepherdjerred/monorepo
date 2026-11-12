/**
 * Whether a keydown belongs to an input method editor's composition. The
 * Enter (and arrows) that pick and confirm a Japanese, Chinese or Korean
 * conversion must not submit or act.
 *
 * Safari delivers `compositionend` before the confirming keydown, clearing
 * `isComposing` too early, so a keydown within 50 ms of the last
 * composition end also counts. Event timestamps, not wall-clock reads, keep
 * that window immune to a blocked main thread.
 */
let lastCompositionEnd: number | undefined;
document.addEventListener(
  "compositionend",
  (event) => {
    lastCompositionEnd = event.timeStamp;
  },
  { capture: true },
);

export function isComposing(event: KeyboardEvent): boolean {
  return (
    event.isComposing ||
    (lastCompositionEnd !== undefined &&
      Math.abs(event.timeStamp - lastCompositionEnd) < 50)
  );
}
