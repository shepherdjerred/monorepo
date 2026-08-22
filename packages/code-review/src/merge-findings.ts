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
 * A finding is resolved once either copy that STILL APPLIES is resolved. Both
 * gestures are deliberate and auditable. Reading resolution off an outdated
 * copy instead would let a stale resolved thread mark a live finding resolved,
 * and the gate blocks on `!isResolved && !isOutdated` — so the merged finding
 * would be neither, and a finding nobody had dealt with would pass. This
 * mirrors how copies *within* the review comment have always been merged
 * (`dedupeRenderedFindings`), so one finding behaves the same however the
 * provider chose to render it.
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
  const byKey = new Map<
    string,
    { finding: ReviewThread; copies: ReviewThread[] }
  >();
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
      const finding = { ...thread };
      byKey.set(key, { finding, copies: [thread] });
      merged.push(finding);
      continue;
    }
    seen.copies.push(thread);
    const { finding } = seen;
    if (
      thread.priority !== null &&
      (finding.priority === null || thread.priority < finding.priority)
    ) {
      finding.priority = thread.priority;
    }
    // Keep whichever handles each copy contributes, so a consumer can act on
    // the finding wherever it lives without re-deriving the other surface.
    finding.threadId ??= thread.threadId;
    finding.commentId ??= thread.commentId;
    finding.line ??= thread.line;
    finding.path ??= thread.path;
  }
  // Decided over the whole group rather than folded in copy by copy, so the
  // answer cannot depend on which surface the provider happened to list first.
  for (const { finding, copies } of byKey.values()) {
    // An outdated copy does not make the finding outdated: the other surface
    // still shows it, so it is still on screen for a reviewer to act on.
    const current = copies.filter((copy) => !copy.isOutdated);
    finding.isOutdated = current.length === 0;
    // Only the copies that still apply may resolve it. When every copy is
    // outdated the finding is outdated anyway, so its resolution gates nothing
    // and is reported from what is there.
    finding.isResolved = (current.length === 0 ? copies : current).some(
      (copy) => copy.isResolved,
    );
    // Only the current copies may determine which review raised the finding.
    // Qodo's persistent comment and addressable thread can both be present,
    // and a later review leaves the old thread outdated beside the new one.
    // Prefer the newest attributed current review; ties are conservative and
    // deterministic because all copies from one review carry the same value.
    const attributionCopies = (current.length === 0 ? copies : current)
      .filter((copy) => copy.raisedInReview !== null)
      .sort((left, right) => {
        const leftReview = left.raisedInReview;
        const rightReview = right.raisedInReview;
        if (leftReview === null || rightReview === null) return 0;
        if (leftReview.ordinal !== rightReview.ordinal) {
          return rightReview.ordinal - leftReview.ordinal;
        }
        return (
          Number(rightReview.hadBlockingSeverity) -
          Number(leftReview.hadBlockingSeverity)
        );
      });
    finding.raisedInReview = attributionCopies[0]?.raisedInReview ?? null;
  }
  return merged;
}
