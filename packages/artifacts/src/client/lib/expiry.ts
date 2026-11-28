import type { BoardSummary } from "@shepherdjerred/artifacts/procedures";

const DAY_MS = 86_400_000;
/** A board idle this long loses its blobs unless kept. */
export const IDLE_DAYS = 90;
/** An archived board loses its blobs after this many days. */
export const ARCHIVE_GRACE_DAYS = 7;
/** The warning turns amber under this many days. */
export const WARN_DAYS = 14;

export type ExpiryNote = {
  readonly text: string;
  readonly amber: boolean;
};

function daysUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / DAY_MS));
}

function plural(days: number): string {
  return days === 1 ? "1 day" : `${String(days)} days`;
}

type ExpiryFields = Pick<
  BoardSummary,
  "keep" | "lastActivityAt" | "archivedAt" | "expiredAt" | "expiresAt"
>;

/**
 * When the cleanup deletes a board's files. The server's `expiresAt` wins;
 * without one it is the last activity plus 90 days, or the archive date plus
 * the 7-day grace. Kept boards never expire.
 */
export function expiryNote(
  board: ExpiryFields,
  now: number = Date.now(),
): ExpiryNote | null {
  if (board.expiredAt !== null) return { text: "Files deleted", amber: true };
  if (board.keep) return null;
  const at =
    board.expiresAt === null
      ? board.archivedAt === null
        ? Date.parse(board.lastActivityAt) + IDLE_DAYS * DAY_MS
        : Date.parse(board.archivedAt) + ARCHIVE_GRACE_DAYS * DAY_MS
      : Date.parse(board.expiresAt);
  const days = daysUntil(at, now);
  return {
    text: days === 0 ? "Expires today" : `Expires in ${plural(days)}`,
    amber: days < WARN_DAYS,
  };
}
