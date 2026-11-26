/** One side of a side-by-side diff row: a line and its 1-based number. */
export type DiffCell = {
  readonly number: number;
  readonly text: string;
  /** True when the line is not on the other side (removed or added). */
  readonly changed: boolean;
};

/** One display row; a missing side is a gap opposite an added or removed line. */
export type DiffRow = {
  readonly left?: DiffCell;
  readonly right?: DiffCell;
};

type Op =
  | { readonly kind: "same"; readonly left: number; readonly right: number }
  | { readonly kind: "removed"; readonly left: number }
  | { readonly kind: "added"; readonly right: number };

/** Longest-common-subsequence edit script over whole lines. */
function editScript(left: readonly string[], right: readonly string[]): Op[] {
  const rows = left.length + 1;
  const columns = right.length + 1;
  // lengths[i * columns + j] = LCS length of left[i..] and right[j..].
  const lengths = new Uint32Array(rows * columns);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      lengths[i * columns + j] =
        left[i] === right[j]
          ? (lengths[(i + 1) * columns + j + 1] ?? 0) + 1
          : Math.max(
              lengths[(i + 1) * columns + j] ?? 0,
              lengths[i * columns + j + 1] ?? 0,
            );
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      ops.push({ kind: "same", left: i, right: j });
      i += 1;
      j += 1;
    } else if (
      (lengths[(i + 1) * columns + j] ?? 0) >=
      (lengths[i * columns + j + 1] ?? 0)
    ) {
      ops.push({ kind: "removed", left: i });
      i += 1;
    } else {
      ops.push({ kind: "added", right: j });
      j += 1;
    }
  }
  for (; i < left.length; i += 1) ops.push({ kind: "removed", left: i });
  for (; j < right.length; j += 1) ops.push({ kind: "added", right: j });
  return ops;
}

function cell(source: readonly string[], index: number, changed: boolean) {
  return { number: index + 1, text: source[index] ?? "", changed };
}

/** An empty text has no lines, so an absent side shows as all gaps. */
function lines(text: string): string[] {
  return text.length === 0 ? [] : text.split("\n");
}

/**
 * Aligns two texts line by line for a side-by-side view. Unchanged lines share
 * a row; a run of removed lines pairs with the run of added lines after it, and
 * the shorter run leaves gaps.
 */
export function sideBySide(leftText: string, rightText: string): DiffRow[] {
  const left = lines(leftText);
  const right = lines(rightText);
  const rows: DiffRow[] = [];
  let removed: number[] = [];
  let added: number[] = [];
  const flush = (): void => {
    const length = Math.max(removed.length, added.length);
    for (let index = 0; index < length; index += 1) {
      const leftIndex = removed[index];
      const rightIndex = added[index];
      rows.push({
        ...(leftIndex === undefined
          ? {}
          : { left: cell(left, leftIndex, true) }),
        ...(rightIndex === undefined
          ? {}
          : { right: cell(right, rightIndex, true) }),
      });
    }
    removed = [];
    added = [];
  };
  for (const op of editScript(left, right)) {
    if (op.kind === "removed") removed.push(op.left);
    else if (op.kind === "added") added.push(op.right);
    else {
      flush();
      rows.push({
        left: cell(left, op.left, false),
        right: cell(right, op.right, false),
      });
    }
  }
  flush();
  return rows;
}
