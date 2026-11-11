type Reveal = (identifier: string) => boolean;
let reveal: Reveal | undefined;

/**
 * A windowed list renders only the rows near the viewport. It registers how
 * to bring any of its issues into the window so the keyboard can reach rows
 * that are not in the document yet.
 */
export function registerReveal(next: Reveal) {
  reveal = next;
  return () => {
    if (reveal === next) {
      reveal = undefined;
    }
  };
}

const rowOf = (identifier: string) =>
  document.querySelector<HTMLAnchorElement>(
    `a[data-issue-row="${CSS.escape(identifier)}"]`,
  );

function focus(row: HTMLAnchorElement) {
  row.focus({ preventScroll: true });
  row.scrollIntoView({ block: "nearest" });
}

/** Move keyboard focus to an issue's row, scrolling it into the window first. */
export function focusIssueRow(identifier: string) {
  const row = rowOf(identifier);
  if (row !== null) {
    focus(row);
    return true;
  }
  if (reveal?.(identifier) !== true) {
    return false;
  }
  // The row mounts on a frame after the scroll; give it a few to appear.
  let frames = 30;
  function attempt() {
    const mounted = rowOf(identifier);
    if (mounted !== null) {
      focus(mounted);
    } else if (frames > 0) {
      frames -= 1;
      requestAnimationFrame(attempt);
    }
  }
  requestAnimationFrame(attempt);
  return true;
}
