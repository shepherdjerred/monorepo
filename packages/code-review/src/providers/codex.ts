import { parseCodexSeverity } from "../severity.ts";
import type { ReviewProvider } from "../types.ts";

const RECEIPT_MARKER = "<!-- codex-review-receipt:v1 -->";

/**
 * The commit a clean Codex review receipt names, or null.
 *
 * Codex answers a clean review with an issue comment — "Codex Review: Didn't
 * find any major issues." and "**Reviewed commit:** `<sha>`" — and sometimes
 * no 👍 at all, so a gate that only watched the reaction timed out on a PR
 * Codex had already passed (#4014). Only the clean wording counts; the SHA is
 * a 10-character abbreviation.
 */
export function parseCodexReceiptHead(body: string): string | null {
  if (!body.includes(RECEIPT_MARKER)) return null;
  if (!/Codex Review: Didn['’]t find any major issues/u.test(body)) return null;
  const match = /\*\*Reviewed commit:\*\*\s*`([0-9a-f]{7,40})`/iu.exec(body);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Codex (OpenAI's `chatgpt-codex-connector` GitHub app) — the active reviewer.
 *
 * Completion: Codex posts NO check-run and NO commit status. It submits a PR
 * *review* whose `commit_id` is the reviewed commit (body starts
 * `### 💡 Codex Review`), and it auto-re-reviews on push. On a clean PR it
 * leaves no review object — only a receipt comment naming the reviewed commit,
 * usually with a 👍 reaction — so `cleanSignal` accepts either as "reviewed,
 * nothing to flag".
 *
 * Severity: Codex flags P0..P2 via shields.io badges (`![P2 Badge](…)`); the
 * docs claim P0/P1-only but live PRs show P2, so we keep the full P0..P3 range.
 *
 * Bot PRs: only the local justin-principal-engineer runner requires Codex's
 * review-at-head gate. Other bot PRs retain the skip behavior because Codex has
 * no documented skip marker and may not review those producers.
 */
export const codexProvider: ReviewProvider = {
  id: "codex",
  displayName: "Codex",
  startsReviewOnPush: false,
  botAuthoredPullRequestPolicy: "review",
  botAuthorAllowlist: ["justin-principal-engineer[bot]"],
  authorLogins: ["chatgpt-codex-connector"],
  parseSeverity: parseCodexSeverity,
  // Codex posts each finding once, as an addressable thread, so there is
  // nothing to recognise a second copy of.
  parseFindingTitle: null,
  findingKey: null,
  parseReviewBodyFindings: null,
  completion: {
    kind: "review-at-head",
    cleanSignal: {
      marker: RECEIPT_MARKER,
      parseReviewedHead: parseCodexReceiptHead,
      alsoThumbsUpReaction: true,
    },
  },
  detectSkip: null,
  // When the account's review quota is exhausted Codex answers with an issue
  // comment instead of a review, so without this the gate polls to its
  // deadline and times out. Two wordings observed live (PR #3058): the full
  // "… usage limits for code reviews … add credits …" notice and a short
  // "… usage limits." one, so the shared prefix is the whole matcher. It stays
  // precise through the exact author match, the head-push binding, and the
  // completion-wins ordering — a real review always beats a block notice.
  detectBlocked: [
    {
      matches: ["reached your Codex usage limits"],
      reason: "usage-limited",
      remediation:
        "Add credits to the Codex account and enable them for code reviews (see the Codex usage dashboard)",
    },
  ],
  // Codex's "Automatic reviews" setting reviews a pull request when it is
  // opened, not on every push, so a new head still has to be asked for
  // explicitly. There is no per-push configuration to move this to.
  requestReview: { command: "@codex review" },
};
