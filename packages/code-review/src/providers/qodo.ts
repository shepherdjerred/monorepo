import type {
  ReviewIssueComment,
  ReviewProvider,
  ReviewThread,
} from "../types.ts";

const QODO_LOGIN = "qodo-code-review";
const QODO_REVIEW_MARKER = "<h3>Code Review by Qodo</h3>";

/**
 * Qodo's hosted GitHub integration keeps its review in one issue comment.
 * Findings under "Action required" are P1-equivalent; findings under
 * "Remediation recommended" are P2-equivalent. A checked or struck-through
 * finding is resolved in Qodo's persistent comment.
 */
export function parseQodoIssueComment(
  comment: ReviewIssueComment,
): readonly ReviewThread[] {
  const sections = comment.body.split(
    /(?=<img[^>]+alt=["'](?:Action required|Remediation recommended)["'])/iu,
  );
  const findings: ReviewThread[] = [];

  for (const section of sections) {
    const priority = /alt=["']Action required["']/iu.test(section)
      ? 1
      : /alt=["']Remediation recommended["']/iu.test(section)
        ? 2
        : null;
    if (priority === null) continue;

    const summaries = section.split("<summary>").slice(1);
    for (const summaryPart of summaries) {
      const summaryEnd = summaryPart.indexOf("</summary>");
      if (summaryEnd === -1) continue;
      const summary = summaryPart.slice(0, summaryEnd);
      if (!/^\s*\d+\./u.test(summary)) continue;
      const findingBody = summaryPart.slice(summaryEnd + "</summary>".length);
      const struck = /<s>[\s\S]*?<\/s>/iu.test(summary);
      const checked = summary.includes("☑");
      const linkMatch =
        /<code>\[([^\n]+)\]\((https:\/\/github\.com\/[^)]+)\)<\/code>/iu.exec(
          findingBody,
        );
      const rawPath = linkMatch?.[1] ?? null;
      const path = rawPath?.replace(/\[R\d+(?:-\d+)?\]$/u, "") ?? null;
      findings.push({
        authorLogin: QODO_LOGIN,
        isResolved: struck || checked,
        isOutdated: false,
        path,
        line: null,
        url: linkMatch?.[2] ?? comment.url,
        priority,
      });
    }
  }

  return findings;
}

function parseQodoSeverity(body: string | null): number | null {
  if (body === null) return null;
  if (/action required/iu.test(body)) return 1;
  if (/remediation recommended/iu.test(body)) return 2;
  return null;
}

export const qodoProvider: ReviewProvider = {
  id: "qodo",
  displayName: "Qodo",
  // Qodo skips bot-authored PRs by default (`ignore_bot_pr = true`). Keep the
  // gate's bot behavior explicit until Qodo is configured otherwise.
  botAuthoredPullRequestPolicy: "skip",
  authorLogins: [QODO_LOGIN],
  parseSeverity: parseQodoSeverity,
  completion: { kind: "issue-comment", marker: QODO_REVIEW_MARKER },
  parseIssueComment: parseQodoIssueComment,
  detectSkip: null,
  requestReview: {
    buildComment: (marker) => `/review\n\n${marker}`,
  },
};
