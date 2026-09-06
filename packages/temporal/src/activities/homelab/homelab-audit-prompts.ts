/**
 * The runbook is the single source of truth for what the audit covers.
 * It ships with the Temporal worker at `runbooks/homelab-audit.md`.
 * Local development can override it with `RUNBOOK_PATH`.
 */
const DEFAULT_RUNBOOK_URL = new URL(
  "../../../runbooks/homelab-audit.md",
  import.meta.url,
);

export type SectionsFilter = readonly number[] | "all";

export type BuildAuditPromptInput = {
  /** ISO date for the audit ("YYYY-MM-DD"). */
  date: string;
  /** Verbatim runbook content. */
  runbook: string;
  /** Numeric section IDs to keep, or `"all"` for the full runbook. */
  sections: SectionsFilter;
  /** Tooling preflight result to carry into the report agent. */
  toolingPreflightMarkdown?: string | undefined;
};

export async function loadRunbook(): Promise<string> {
  const localPath = Bun.env["RUNBOOK_PATH"];
  const source =
    localPath === undefined || localPath === ""
      ? DEFAULT_RUNBOOK_URL
      : localPath;
  return await Bun.file(source).text();
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
   "- Open Alerts occurrences: <P>"
4. Then a "Cluster Overview" key/value table.
5. Then per-section findings (only sections with non-Green items appear).
6. Then a full Application Health Matrix table covering every ArgoCD application.
7. Then an Alerts Occurrence Triage table (one row per open occurrence).
8. Then "What's working well" and "Followups" sections.
9. Use 🟢 / 🟡 / 🔴 emoji prefixes inside the matrix as in the runbook examples.
10. NEVER mutate state. All commands must be read-only. Do not run \`kubectl apply\`, \`tofu apply\`, \`argocd app sync\`, or any alert acknowledgement or resolution operation. Do not delete files. Do not push to git.
11. Hard size cap: ≤ 25 KB total. Trim verbose log paste-ins to the minimum needed for triage.
`.trim();

const TOOL_INVENTORY = `
Available tools (already authenticated in this environment — do not attempt to log in):

- \`kubectl\` — context \`admin@torvalds\`. Read-only RBAC; do not attempt write verbs.
- \`talosctl\` — context \`torvalds\` (\`TALOSCONFIG=/etc/talos/config\` projected from the worker pod's secret). If talosctl errors with "Forbidden" or "no such file", note it in the audit and fall back to kubectl-derived signal for §1.
- \`toolkit argocd\` — \`ARGOCD_SERVER\` + \`ARGOCD_AUTH_TOKEN\` are set; the wrapper supplies \`--grpc-web\`.
- \`velero\` — uses in-cluster auth.
- \`tofu\` — for state inspection only. First confirm \`packages/homelab/src/cdk8s/src/tofu/cloudflare\` exists in the worker checkout, then run \`tofu -chdir=packages/homelab/src/cdk8s/src/tofu/cloudflare plan -detailed-exitcode\` to detect drift; exit code 2 from this command means "drift detected" (NOT a failure) — report the drift in the audit body and continue. Never run \`tofu apply\`.
- \`toolkit gh\` — GitHub CLI for the open-PR survey (§12), scoped to this monorepo by default.
- \`toolkit bk\` — Buildkite CLI. \`BUILDKITE_API_TOKEN\`, \`BUILDKITE_ORGANIZATION_SLUG=sjerred\`, and \`BUILDKITE_PIPELINE_SLUG=monorepo\` are set; Buildkite is the source of truth for CI.
- \`toolkit temporal\` — Temporal CLI. \`TEMPORAL_ADDRESS\` points at the in-cluster frontend service; the wrapper's local homelab profile may be overridden by this explicit environment. Do not use \`kubectl exec\` or \`kubectl port-forward\` for routine audit checks.
- \`toolkit\` — local binary at /usr/local/bin/toolkit. Monorepo workflows and observability passthroughs the runbook calls for:
  - \`toolkit alerts list --state open [--json]\` — open Alerts occurrences (§6).
  - \`toolkit bugsink issues [--json]\` — open Bugsink issues (§9). \`toolkit bugsink issue <ID>\` for details.
  - \`toolkit prom query 'ALERTS{alertstate="firing"}'\` is the primary alert truth. \`toolkit grafana alert rules list\` lists Grafana-managed rules only and may correctly return no rules when PrometheusRule/Alertmanager owns alerting.
  - \`toolkit prom query '<promql>'\` / \`toolkit loki query '<logql>' --since 24h --limit 50\` (§6, §10).
  All required env vars (\`ALERT_DASHBOARD_URL\`, \`BUGSINK_URL\`, \`BUGSINK_TOKEN\`, \`GRAFANA_URL\`, \`GRAFANA_API_KEY\`) are already injected.
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
    input.toolingPreflightMarkdown?.trim() ??
      "Audit tooling preflight: all required local tooling was present; no remote warnings were recorded before agent start.",
    "",
    OUTPUT_REQUIREMENTS,
    "",
    "Return ONLY the Markdown audit body. Begin your response with the top-level heading and end with the Followups section. No preamble, no code fences, no commentary.",
  ].join("\n");
}
