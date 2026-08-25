import { z } from "zod/v4";
import {
  maintenanceActivityHooks,
  spawnMaintenanceCommandCapturingStdout,
  type MaintenanceCommandHooks,
} from "./maintenance.ts";
import {
  mainRepositoryScanCommand,
  withMainRepositoryScan,
} from "./main-repository-scan.ts";
const EXCERPT_LIMIT = 2000;
/** lychee reserves exit 2 for "broken links found" — a finding, not a crash. */
const LYCHEE_FINDINGS_EXIT_CODE = 2;

/**
 * Minimal schema for the slice of lychee's `--format json` output this scan
 * consumes: the aggregate counters plus the per-source maps of failed and
 * timed-out links. `status.code` is only present for HTTP-status failures;
 * network errors carry text only.
 */
const LycheeLinkStatusSchema = z.object({
  text: z.string().min(1),
  code: z.number().int().optional(),
  details: z.string().optional(),
});

const LycheeLinkSchema = z.object({
  url: z.string().min(1),
  status: LycheeLinkStatusSchema,
  span: z.object({ line: z.number().int() }).optional(),
});

const LycheeReportSchema = z.object({
  total: z.number().int().nonnegative(),
  successful: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  timeouts: z.number().int().nonnegative(),
  excludes: z.number().int().nonnegative(),
  error_map: z.record(z.string(), z.array(LycheeLinkSchema)),
  timeout_map: z.record(z.string(), z.array(LycheeLinkSchema)),
});

export type DeadLink = {
  url: string;
  source: string;
  status: string;
  statusCode?: number;
  line?: number;
};

export type LinkRotScanResult = {
  observedAt: string;
  repoSha: string;
  command: string;
  exitCode: number;
  totalLinks: number;
  successfulLinks: number;
  excludedLinks: number;
  deadLinks: DeadLink[];
  timedOutLinks: DeadLink[];
  /** Bounded evidence excerpt (dead link per source). */
  excerpt: string;
};

function flattenLinkMap(
  map: Record<string, z.infer<typeof LycheeLinkSchema>[]>,
): DeadLink[] {
  return Object.entries(map).flatMap(([source, links]) =>
    links.map((link) => ({
      url: link.url,
      source,
      status: link.status.text,
      ...(link.status.code === undefined
        ? {}
        : { statusCode: link.status.code }),
      ...(link.span === undefined ? {} : { line: link.span.line }),
    })),
  );
}

export type ParsedLycheeReport = {
  totalLinks: number;
  successfulLinks: number;
  excludedLinks: number;
  deadLinks: DeadLink[];
  timedOutLinks: DeadLink[];
};

/** Pure: lychee JSON text → typed dead/timed-out link lists. */
export function parseLycheeReport(json: string): ParsedLycheeReport {
  const report = LycheeReportSchema.parse(JSON.parse(json));
  return {
    totalLinks: report.total,
    successfulLinks: report.successful,
    excludedLinks: report.excludes,
    deadLinks: flattenLinkMap(report.error_map),
    timedOutLinks: flattenLinkMap(report.timeout_map),
  };
}

/** Pure: bounded plain-text evidence excerpt for the report receipt. */
export function buildLinkRotExcerpt(parsed: ParsedLycheeReport): string {
  const summary = `${String(parsed.totalLinks)} links checked, ${String(parsed.deadLinks.length)} dead, ${String(parsed.timedOutLinks.length)} timed out, ${String(parsed.excludedLinks)} excluded`;
  const lines = parsed.deadLinks.map(
    (link) => `${link.status}: ${link.url} (${link.source})`,
  );
  return [summary, ...lines].join("\n").slice(0, EXCERPT_LIMIT);
}

// Runs from the clone root, so the clone's own lychee.toml and .lycheeignore
// apply — configuration is versioned with the markdown it governs.
const LYCHEE_SCAN_COMMAND = [
  "lychee",
  "--config",
  "lychee.toml",
  "--format",
  "json",
  "--no-progress",
  ".",
] as const;

/**
 * Shallow-clones current `main` (public repo — no credentials) and runs lychee
 * over the tracked markdown per the root lychee.toml. Runs on
 * TASK_QUEUES.DEFAULT: unlike the Trivy scan there is no warm cache to reuse,
 * and the core worker image carries the pinned lychee binary.
 */
async function scanMainForLinkRot(
  hooks: MaintenanceCommandHooks = maintenanceActivityHooks(),
): Promise<LinkRotScanResult> {
  return withMainRepositoryScan(
    "link-rot-scan",
    hooks,
    async ({ repoDir, repoSha }) => {
      const scan = await spawnMaintenanceCommandCapturingStdout(
        mainRepositoryScanCommand(
          "link-rot-scan",
          LYCHEE_SCAN_COMMAND,
          repoDir,
        ),
        hooks,
        { acceptedExitCodes: [0, LYCHEE_FINDINGS_EXIT_CODE] },
      );
      const parsed = parseLycheeReport(scan.stdout);
      return {
        observedAt: new Date().toISOString(),
        repoSha,
        command: LYCHEE_SCAN_COMMAND.join(" "),
        exitCode: scan.exitCode,
        ...parsed,
        excerpt: buildLinkRotExcerpt(parsed),
      };
    },
  );
}

export const linkRotScanActivities = {
  async scanMainForLinkRot(): Promise<LinkRotScanResult> {
    return scanMainForLinkRot();
  },
};

export type LinkRotScanActivities = typeof linkRotScanActivities;
