import { parseCodexSeverity } from "../severity.ts";
import type { ReviewProvider } from "../types.ts";

/**
 * Codex (OpenAI's `chatgpt-codex-connector` GitHub app) — the active reviewer.
 *
 * Completion: Codex posts NO check-run and NO commit status. It submits a PR
 * *review* whose `commit_id` is the reviewed commit (body starts
 * `### 💡 Codex Review`), and it auto-re-reviews on push. On a clean PR it
 * leaves no review object — only a 👍 reaction — so `cleanSignal` tells the
 * gate to treat a 👍 from the connector as "reviewed, nothing to flag".
 *
 * Severity: Codex flags P0..P2 via shields.io badges (`![P2 Badge](…)`); the
 * docs claim P0/P1-only but live PRs show P2, so we keep the full P0..P3 range.
 *
 * Skip: Codex has no documented skip marker; a no-findings result is the 👍
 * clean signal, handled by the completion strategy rather than a skip.
 */
export const codexProvider: ReviewProvider = {
  id: "codex",
  displayName: "Codex",
  botAuthoredPullRequestPolicy: "skip",
  authorLogins: ["chatgpt-codex-connector"],
  parseSeverity: parseCodexSeverity,
  completion: { kind: "review-at-head", cleanSignal: "thumbsup-reaction" },
  detectSkip: null,
};
