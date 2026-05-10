/**
 * The runbook is the single source of truth for what the audit covers.
 * Live in the repo at `packages/docs/guides/2026-04-04_homelab-audit-runbook.md`.
 *
 * Fetched at activity startup over HTTPS so runbook edits take effect on the
 * next scheduled run without a worker redeploy. Local dev overrides via
 * `RUNBOOK_PATH` to point at the in-tree copy.
 */
const RUNBOOK_URL =
  "https://raw.githubusercontent.com/shepherdjerred/monorepo/main/packages/docs/guides/2026-04-04_homelab-audit-runbook.md";

const RUNBOOK_FETCH_TIMEOUT_MS = 15_000;

export type SectionsFilter = readonly number[] | "all";

export type BuildAuditPromptInput = {
  /** ISO date for the audit ("YYYY-MM-DD"). */
  date: string;
  /** Verbatim runbook content. */
  runbook: string;
  /** Numeric section IDs to keep, or `"all"` for the full runbook. */
  sections: SectionsFilter;
};

export async function loadRunbook(): Promise<string> {
  const localPath = Bun.env["RUNBOOK_PATH"];
  if (localPath !== undefined && localPath !== "") {
    return await Bun.file(localPath).text();
  }
  const response = await fetch(RUNBOOK_URL, {
    signal: AbortSignal.timeout(RUNBOOK_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch homelab audit runbook (HTTP ${String(response.status)}): ${RUNBOOK_URL}`,
    );
  }
  return await response.text();
}

/**
 * Trim the runbook down to the requested numeric section IDs while keeping
 * its leading framing. Section headings are matched case-insensitively
 * against `## Section <N>` (the convention used by the runbook).
 */
export function filterRunbookSections(
  runbook: string,
  sections: SectionsFilter,
): string {
  if (sections === "all") {
    return runbook;
  }
  const wanted = new Set(sections);
  const lines = runbook.split("\n");

  const head: string[] = [];
  const sectionedBlocks: string[][] = [];
  let inSection = false;
  let keepCurrent = false;
  let currentBlock: string[] = [];

  const sectionHeadingPattern = /^##\s+section\s+(\d+)/i;

  for (const line of lines) {
    const headingMatch = sectionHeadingPattern.exec(line);
    if (headingMatch !== null) {
      if (inSection && keepCurrent) {
        sectionedBlocks.push(currentBlock);
      }
      currentBlock = [];
      const id = Number(headingMatch[1]);
      keepCurrent = wanted.has(id);
      inSection = true;
    }
    if (inSection) {
      currentBlock.push(line);
    } else {
      head.push(line);
    }
  }
  if (inSection && keepCurrent) {
    sectionedBlocks.push(currentBlock);
  }

  return [head.join("\n"), ...sectionedBlocks.map((b) => b.join("\n"))]
    .filter((s) => s.length > 0)
    .join("\n\n");
}

const OUTPUT_REQUIREMENTS = `
Output requirements (strict):

1. Single Markdown document, plain text only — no preamble, no trailing commentary, no surrounding code fences.
2. First section: a top-level heading ("# Homelab Health Audit — <date>") followed by a "TL;DR" subsection (≤ 8 bullets).
3. Include a one-line that follows the runbook's exact phrasing, verbatim — the email subject parser depends on it:
   "- Application Health Matrix: <R> Red / <Y> Yellow / <G> Green (<N> ArgoCD apps)"
   "- Open PagerDuty incidents: <P>"
4. Then a "Cluster Overview" key/value table.
5. Then per-section findings (only sections with non-Green items appear).
6. Then a full Application Health Matrix table covering every ArgoCD application.
7. Then a PagerDuty Incident Triage table (one row per open incident).
8. Then "What's working well" and "Followups" sections.
9. Use 🟢 / 🟡 / 🔴 emoji prefixes inside the matrix as in the runbook examples.
10. NEVER mutate state. All commands must be read-only. Do not run \`kubectl apply\`, \`tofu apply\`, \`argocd app sync\`, or any PagerDuty resolve / acknowledge / snooze. Do not delete files. Do not push to git.
11. Hard size cap: ≤ 25 KB total. Trim verbose log paste-ins to the minimum needed for triage.
`.trim();

const TOOL_INVENTORY = `
Available tools (already authenticated in this environment — do not attempt to log in):

- \`kubectl\` — context \`admin@torvalds\`. Read-only RBAC; do not attempt write verbs.
- \`talosctl\` — context \`torvalds\` (\`TALOSCONFIG=/etc/talos/config\` projected from the worker pod's secret). If talosctl errors with "Forbidden" or "no such file", note it in the audit and fall back to kubectl-derived signal for §1.
- \`argocd\` — \`ARGOCD_SERVER\` + \`ARGOCD_AUTH_TOKEN\` are set; pass \`--grpc-web\` if the transport demands it.
- \`velero\` — uses in-cluster auth.
- \`tofu\` — for state inspection only. Run \`tofu -chdir=packages/homelab/src/cdk8s/src/tofu/cloudflare plan -detailed-exitcode\` to detect drift; exit code 2 from this command means "drift detected" (NOT a failure) — report the drift in the audit body and continue. Never run \`tofu apply\`.
- \`gh\` — for the open-PR survey (§12).
- \`toolkit\` — local binary at /usr/local/bin/toolkit. Subcommands the runbook calls for:
  - \`toolkit pd incidents [--json]\` — open PagerDuty incidents (§6).
  - \`toolkit bugsink issues [--json]\` — open Bugsink issues (§9). \`toolkit bugsink issue <ID>\` for details.
  - \`toolkit gf alerts\` / \`toolkit gf query '<promql>'\` / \`toolkit gf logs '<logql>' --since 24h --limit 50\` (§6, §10).
  All required env vars (\`PAGERDUTY_TOKEN\`, \`BUGSINK_URL\`, \`BUGSINK_TOKEN\`, \`GRAFANA_URL\`, \`GRAFANA_API_KEY\`) are already injected.
`.trim();

export function buildAuditPrompt(input: BuildAuditPromptInput): string {
  const filteredRunbook = filterRunbookSections(input.runbook, input.sections);
  return [
    `You are running the homelab daily health audit for the \`torvalds\` cluster. Today is ${input.date}.`,
    "",
    "Follow this runbook EXACTLY. Run every section assigned to you and report its findings in the output document.",
    "",
    "<<< RUNBOOK BEGIN >>>",
    filteredRunbook.trim(),
    "<<< RUNBOOK END >>>",
    "",
    TOOL_INVENTORY,
    "",
    OUTPUT_REQUIREMENTS,
    "",
    "Return ONLY the Markdown audit body. Begin your response with the top-level heading and end with the Followups section. No preamble, no code fences, no commentary.",
  ].join("\n");
}
