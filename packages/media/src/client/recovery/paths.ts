import type { MediaUser } from "#shared/contract.ts";

/**
 * Where the recovery pages are for this reader. The owner's list is a Manage
 * page, which `/recovery` sends them to; a member's list is `/recovery`.
 * One review is at the same address for both, so a link in a message works
 * for whoever opens it.
 */
type Reader = Pick<MediaUser, "role">;

/** The list of reviews. */
export function recoveryPath(reader: Reader): string {
  return reader.role === "owner" ? "/manage/recovery" : "/recovery";
}

/** One household review. */
export function reviewPath(id: string): string {
  return `/recovery/${encodeURIComponent(id)}`;
}

/** One movie edition review. */
export function movieReviewPath(id: string): string {
  return `/recovery/movies/${encodeURIComponent(id)}`;
}
