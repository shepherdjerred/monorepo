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
/**
 * The warm Trivy database PVC mounted into the maintenance worker — kept fresh
 * every six hours by `buildkite-trivy-db-refresh`, which is why the scan runs
 * with `--skip-db-update` on the maintenance queue instead of downloading a
 * database per run on an unscoped worker.
 */
const TRIVY_CACHE_DIR = "/buildkite/trivy-db";
const EXCERPT_LIMIT = 2000;

/**
 * Minimal schema for the slice of Trivy's JSON report this scan consumes.
 * Severity is a closed enum on purpose: the command requests only
 * HIGH,CRITICAL, so anything else appearing is a contract change that should
 * fail loudly rather than be silently bucketed.
 */
const TrivyVulnerabilitySchema = z.object({
  VulnerabilityID: z.string().min(1),
  PkgName: z.string().min(1),
  InstalledVersion: z.string().min(1),
  FixedVersion: z.string().optional(),
  Severity: z.enum(["HIGH", "CRITICAL"]),
  Title: z.string().optional(),
  PrimaryURL: z.string().optional(),
});

const TrivyResultSchema = z.object({
  Target: z.string().min(1),
  Vulnerabilities: z.array(TrivyVulnerabilitySchema).optional(),
});

/**
 * `Results` is legitimately absent from a clean scan — trivy 0.72.0 emits only
 * the envelope (`SchemaVersion`, `Trivy`, `ArtifactName`, …) when it finds
 * nothing. An optional-only schema therefore cannot tell "nothing found" from
 * "the top-level contract drifted", and the latter would publish a false
 * `clear` report and resolve a live critical alert.
 *
 * Pinning the expected `SchemaVersion` closes that: `{}` or a renamed result
 * field fails loudly instead of reading as a clean scan. The trivy binary is
 * version-pinned in the worker image, so a schema bump is a deliberate,
 * reviewed event rather than a surprise.
 */
const TRIVY_SCHEMA_VERSION = 2;

const TrivyReportSchema = z.object({
  SchemaVersion: z.literal(TRIVY_SCHEMA_VERSION),
  Results: z.array(TrivyResultSchema).optional(),
});

export type MainVulnScanVulnerability = {
  vulnerabilityId: string;
  pkgName: string;
  installedVersion: string;
  fixedVersion?: string;
  severity: "HIGH" | "CRITICAL";
  target: string;
  title?: string;
  primaryUrl?: string;
};

export type MainVulnScanResult = {
  observedAt: string;
  repoSha: string;
  command: string;
  exitCode: number;
  vulnerabilities: MainVulnScanVulnerability[];
  /** Bounded evidence excerpt (vulnerability ids per target). */
  excerpt: string;
};

/** Pure: Trivy JSON text → typed HIGH/CRITICAL vulnerability list. */
export function parseTrivyReport(json: string): MainVulnScanVulnerability[] {
  const report = TrivyReportSchema.parse(JSON.parse(json));
  return (report.Results ?? []).flatMap((result) =>
    (result.Vulnerabilities ?? []).map((vulnerability) => ({
      vulnerabilityId: vulnerability.VulnerabilityID,
      pkgName: vulnerability.PkgName,
      installedVersion: vulnerability.InstalledVersion,
      severity: vulnerability.Severity,
      target: result.Target,
      ...(vulnerability.FixedVersion === undefined
        ? {}
        : { fixedVersion: vulnerability.FixedVersion }),
      ...(vulnerability.Title === undefined
        ? {}
        : { title: vulnerability.Title }),
      ...(vulnerability.PrimaryURL === undefined
        ? {}
        : { primaryUrl: vulnerability.PrimaryURL }),
    })),
  );
}

/** Pure: bounded plain-text evidence excerpt for the report receipt. */
export function buildScanExcerpt(
  vulnerabilities: readonly MainVulnScanVulnerability[],
): string {
  if (vulnerabilities.length === 0) {
    return "0 HIGH/CRITICAL vulnerabilities";
  }
  const lines = vulnerabilities.map(
    (vulnerability) =>
      `${vulnerability.severity} ${vulnerability.vulnerabilityId} ${vulnerability.pkgName}@${vulnerability.installedVersion} (${vulnerability.target})`,
  );
  return [`${String(vulnerabilities.length)} HIGH/CRITICAL:`, ...lines]
    .join("\n")
    .slice(0, EXCERPT_LIMIT);
}

const TRIVY_SCAN_COMMAND = [
  "trivy",
  "fs",
  "--format",
  "json",
  "--skip-db-update",
  "--cache-dir",
  TRIVY_CACHE_DIR,
  "--scanners",
  "vuln",
  "--severity",
  "HIGH,CRITICAL",
  "--skip-dirs",
  "node_modules",
  "--skip-dirs",
  "sandbox",
  ".",
] as const;

/**
 * Shallow-clones current `main` (the repo is public — no credentials) and runs
 * a Trivy filesystem scan for HIGH/CRITICAL vulnerabilities against the warm
 * Buildkite Trivy database. The clone's own `.trivyignore` applies
 * automatically because the scan runs from the clone root.
 *
 * Runs on the maintenance queue: that worker mounts the warm DB PVC, and its
 * single activity slot cannot race the six-hourly DB refresh writer.
 */
async function scanMainForVulnerabilities(
  hooks: MaintenanceCommandHooks = maintenanceActivityHooks(),
): Promise<MainVulnScanResult> {
  return withMainRepositoryScan(
    "main-vuln-scan",
    hooks,
    async ({ repoDir, repoSha }) => {
      const scan = await spawnMaintenanceCommandCapturingStdout(
        mainRepositoryScanCommand(
          "main-vuln-scan",
          TRIVY_SCAN_COMMAND,
          repoDir,
        ),
        hooks,
      );
      const vulnerabilities = parseTrivyReport(scan.stdout);
      return {
        observedAt: new Date().toISOString(),
        repoSha,
        command: TRIVY_SCAN_COMMAND.join(" "),
        exitCode: scan.exitCode,
        vulnerabilities,
        excerpt: buildScanExcerpt(vulnerabilities),
      };
    },
  );
}

export const mainVulnScanActivities = {
  async scanMainForVulnerabilities(): Promise<MainVulnScanResult> {
    return scanMainForVulnerabilities();
  },
};

export type MainVulnScanActivities = typeof mainVulnScanActivities;
