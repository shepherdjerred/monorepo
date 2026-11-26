/**
 * Why a file that is a duplicate by content is left alone, in the order the
 * reasons are looked for and reported. A file is counted under one reason
 * only: the first one found.
 */
const LEFT_ALONE_REASONS = [
  ["hardLinked", "hard-linked elsewhere"],
  ["otherUser", "another user's"],
  ["otherGroup", "in a group other than their worktree directory's"],
  ["flagged", "carrying file flags"],
  ["xattr", "carrying extended attributes"],
  ["open", "open in a process"],
  [
    "sourceMarked",
    "whose copy to clone from carries file flags or extended attributes",
  ],
  [
    "cloneMismatch",
    "whose clone did not come out with their size, owner and group",
  ],
] as const;

export type LeftAloneReason = (typeof LEFT_ALONE_REASONS)[number][0];

export type LeftAloneCounts = Record<LeftAloneReason, number>;

export function noneLeftAlone(): LeftAloneCounts {
  return {
    hardLinked: 0,
    otherUser: 0,
    otherGroup: 0,
    flagged: 0,
    xattr: 0,
    open: 0,
    sourceMarked: 0,
    cloneMismatch: 0,
  };
}

export function addLeftAlone(
  into: LeftAloneCounts,
  from: Readonly<LeftAloneCounts>,
): void {
  for (const [reason] of LEFT_ALONE_REASONS) {
    into[reason] += from[reason];
  }
}

export function leftAloneTotal(counts: Readonly<LeftAloneCounts>): number {
  let total = 0;
  for (const [reason] of LEFT_ALONE_REASONS) {
    total += counts[reason];
  }
  return total;
}

/** `2 open in a process, 1 hard-linked elsewhere`; empty when none. */
export function describeLeftAlone(counts: Readonly<LeftAloneCounts>): string {
  const parts: string[] = [];
  for (const [reason, label] of LEFT_ALONE_REASONS) {
    if (counts[reason] > 0) {
      parts.push(`${String(counts[reason])} ${label}`);
    }
  }
  return parts.join(", ");
}

/**
 * The counts as flat report fields: the total, and one field per reason
 * that occurred (`protectedOpen`, `protectedHardLinked`, ...).
 */
export function leftAloneMetadata(
  counts: Readonly<LeftAloneCounts>,
): Record<string, number> {
  const metadata: Record<string, number> = {
    protectedFiles: leftAloneTotal(counts),
  };
  for (const [reason] of LEFT_ALONE_REASONS) {
    if (counts[reason] > 0) {
      const name = `${reason.charAt(0).toUpperCase()}${reason.slice(1)}`;
      metadata[`protected${name}`] = counts[reason];
    }
  }
  return metadata;
}
