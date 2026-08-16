import { isProviderAuthor } from "./identity.ts";
import type { ReviewProvider, ReviewThread } from "./types.ts";

/**
 * Collapse the copies a provider posts to more than one surface into a single
 * finding.
 *
 * Qodo renders every finding twice — once in its persistent review comment and
 * once as an addressable thread on the offending line — and the two are cleared
 * through different APIs. Counting both made `blocking_count` roughly double
 * the number of real findings and made every finding cost two actions to clear.
 *
 * A finding is resolved once EITHER copy is resolved. Both gestures are
 * deliberate and auditable, and each copy is already scoped to what currently
 * applies: the comment parser reads only the current review section, and
 * outdated threads are excluded downstream. This mirrors how copies *within*
 * the review comment have always been merged (`dedupeRenderedFindings`), so one
 * finding behaves the same however the provider chose to render it.
 *
 * Priority takes the most severe copy, so a disagreement between surfaces can
 * only ever make the gate stricter. A `null` key never merges — an unrecognised
 * finding is counted on its own rather than folded into an unrelated one.
 */
export function mergeDuplicateFindings(
  threads: readonly ReviewThread[],
  provider: ReviewProvider,
): ReviewThread[] {
  const { findingKey } = provider;
  if (findingKey === null) return [...threads];
  const merged: ReviewThread[] = [];
  const byKey = new Map<string, ReviewThread>();
  for (const thread of threads) {
    // Only the configured provider posts a finding twice, so only its own
    // threads may merge. Without this, another reviewer's thread that happened
    // to render a matching headline on the same file would be folded into a
    // provider finding and stop being counted.
    const key = isProviderAuthor(provider, thread.authorLogin)
      ? findingKey(thread)
      : null;
    if (key === null) {
      merged.push(thread);
      continue;
    }
    const seen = byKey.get(key);
    if (seen === undefined) {
      const copy = { ...thread };
      byKey.set(key, copy);
      merged.push(copy);
      continue;
    }
    if (thread.isResolved) seen.isResolved = true;
    // An outdated copy does not make the finding outdated: the other surface
    // still shows it, so it is still on screen for a reviewer to act on.
    if (!thread.isOutdated) seen.isOutdated = false;
    if (
      thread.priority !== null &&
      (seen.priority === null || thread.priority < seen.priority)
    ) {
      seen.priority = thread.priority;
    }
    // Keep whichever handles each copy contributes, so a consumer can act on
    // the finding wherever it lives without re-deriving the other surface.
    seen.threadId ??= thread.threadId;
    seen.commentId ??= thread.commentId;
    seen.line ??= thread.line;
    seen.path ??= thread.path;
  }
  return merged;
}
