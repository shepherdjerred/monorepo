import { z } from "zod";

const key = "tracker.recent.v1";
const kept = 8;
const RecentSchema = z.array(
  z.object({ identifier: z.string(), title: z.string() }),
);
export type RecentIssue = z.infer<typeof RecentSchema>[number];
type RecentStorage = Pick<Storage, "getItem" | "setItem">;

/** The issues opened last, newest first, for the palette's empty state. */
export function createRecentIssues(storage: () => RecentStorage) {
  function read(): RecentIssue[] {
    const saved = storage().getItem(key);
    if (saved === null) {
      return [];
    }
    // The key is versioned: a new shape gets a new key, never a fallback.
    return RecentSchema.parse(JSON.parse(saved));
  }
  return {
    read,
    remember(issue: RecentIssue) {
      const next = [
        issue,
        ...read().filter(({ identifier }) => identifier !== issue.identifier),
      ].slice(0, kept);
      storage().setItem(key, JSON.stringify(next));
    },
  };
}

export const recentIssues = createRecentIssues(() => localStorage);
