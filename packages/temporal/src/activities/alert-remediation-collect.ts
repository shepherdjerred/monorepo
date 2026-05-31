import { z } from "zod/v4";
import {
  AlertRemediationCollectionResultSchema,
  AlertRemediationSweepInputSchema,
  type AlertRemediationCollectionFailure,
  type AlertRemediationCollectionResult,
  type AlertRemediationSweepInput,
  type NormalizedAlert,
} from "#shared/alert-remediation.ts";
import {
  defaultAlertRemediationDeps,
  type AlertRemediationDeps,
} from "./alert-remediation-runtime.ts";

const PagerDutyIncidentCliSchema = z
  .object({
    id: z.string(),
    html_url: z.string().optional(),
    incident_number: z.number().optional(),
    title: z.string(),
    description: z.string().nullable().optional(),
    status: z.string(),
    urgency: z.string().optional(),
    created_at: z.string().optional(),
    updated_at: z.string().optional(),
    service: z.object({ summary: z.string().optional() }).loose().optional(),
  })
  .loose();

const BugsinkProjectCliSchema = z
  .object({
    id: z.number(),
    name: z.string(),
    slug: z.string(),
  })
  .loose();

const BugsinkIssueCliSchema = z
  .object({
    id: z.string(),
    project: z.number(),
    calculated_type: z.string(),
    calculated_value: z.string(),
    transaction: z.string().optional(),
    digested_event_count: z.number().optional(),
    stored_event_count: z.number().optional(),
    first_seen: z.string().optional(),
    last_seen: z.string(),
    is_resolved: z.boolean(),
    is_muted: z.boolean(),
  })
  .loose();

function detailsFrom(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? { ...value } : {};
}

function parseJsonArray<T>(
  raw: string,
  schema: z.ZodType<T>,
  label: string,
): T[] {
  try {
    return z.array(schema).parse(JSON.parse(raw));
  } catch (error: unknown) {
    throw new Error(
      `Failed to parse ${label}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

function alertUrl(sourceUrl: string | undefined): string | undefined {
  if (sourceUrl === undefined || sourceUrl.length === 0) {
    return undefined;
  }
  try {
    return new URL(sourceUrl).toString();
  } catch {
    return undefined;
  }
}

export function normalizePagerDutyIncident(raw: unknown): NormalizedAlert {
  const incident = PagerDutyIncidentCliSchema.parse(raw);
  const service = incident.service?.summary ?? "unknown-service";
  return {
    source: "pagerduty",
    fingerprint: `pagerduty:${incident.id}`,
    title: incident.title,
    status: incident.status,
    severity: incident.urgency,
    url: alertUrl(incident.html_url),
    details: {
      ...detailsFrom(incident),
      service,
      incidentNumber: incident.incident_number,
    },
  };
}

export function normalizeBugsinkIssue(input: {
  project: z.infer<typeof BugsinkProjectCliSchema>;
  issue: unknown;
}): NormalizedAlert {
  const issue = BugsinkIssueCliSchema.parse(input.issue);
  const baseUrl = Bun.env["BUGSINK_URL"];
  const url =
    baseUrl === undefined || baseUrl.length === 0
      ? undefined
      : alertUrl(`${baseUrl.replaceAll(/\/+$/g, "")}/issues/${issue.id}/`);
  return {
    source: "bugsink",
    fingerprint: `bugsink:${input.project.slug}:${issue.id}`,
    title: `${input.project.slug}: ${issue.calculated_type}: ${issue.calculated_value}`,
    status: "unresolved",
    severity: undefined,
    url,
    details: {
      ...detailsFrom(issue),
      projectSlug: input.project.slug,
      projectName: input.project.name,
    },
  };
}

function failure(source: "pagerduty" | "bugsink", error: unknown) {
  return {
    source,
    reason: error instanceof Error ? error.message : String(error),
  };
}

async function collectPagerDutyAlerts(
  input: AlertRemediationSweepInput,
  deps: AlertRemediationDeps,
): Promise<{
  alerts: NormalizedAlert[];
  failures: AlertRemediationCollectionFailure[];
}> {
  try {
    const raw = await deps.runCommand({
      command: [
        "toolkit",
        "pd",
        "incidents",
        "--json",
        "--status",
        "triggered",
        "--status",
        "acknowledged",
        "--limit",
        String(input.pagerDutyLimit),
      ],
      cwd: "/tmp",
    });
    return {
      alerts: parseJsonArray(
        raw,
        PagerDutyIncidentCliSchema,
        "PagerDuty incidents",
      ).map((incident) => normalizePagerDutyIncident(incident)),
      failures: [],
    };
  } catch (error: unknown) {
    return { alerts: [], failures: [failure("pagerduty", error)] };
  }
}

async function collectProjectIssues(
  input: AlertRemediationSweepInput,
  deps: AlertRemediationDeps,
  project: z.infer<typeof BugsinkProjectCliSchema>,
): Promise<{
  alerts: NormalizedAlert[];
  failures: AlertRemediationCollectionFailure[];
}> {
  try {
    const rawIssues = await deps.runCommand({
      command: [
        "toolkit",
        "bugsink",
        "issues",
        "--json",
        "--project",
        project.slug,
        "--limit",
        String(input.bugsinkIssueLimit),
      ],
      cwd: "/tmp",
    });
    const issues = parseJsonArray(
      rawIssues,
      BugsinkIssueCliSchema,
      `Bugsink issues for ${project.slug}`,
    );
    return {
      alerts: issues
        .filter((issue) => !issue.is_resolved && !issue.is_muted)
        .map((issue) => normalizeBugsinkIssue({ project, issue })),
      failures: [],
    };
  } catch (error: unknown) {
    return {
      alerts: [],
      failures: [
        {
          source: "bugsink",
          reason: `${project.slug}: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

async function collectBugsinkAlerts(
  input: AlertRemediationSweepInput,
  deps: AlertRemediationDeps,
): Promise<{
  alerts: NormalizedAlert[];
  failures: AlertRemediationCollectionFailure[];
}> {
  try {
    const rawProjects = await deps.runCommand({
      command: ["toolkit", "bugsink", "projects", "--json"],
      cwd: "/tmp",
    });
    const projects = parseJsonArray(
      rawProjects,
      BugsinkProjectCliSchema,
      "Bugsink projects",
    );
    const results = await Promise.all(
      projects.map((project) => collectProjectIssues(input, deps, project)),
    );
    return {
      alerts: results.flatMap((result) => result.alerts),
      failures: results.flatMap((result) => result.failures),
    };
  } catch (error: unknown) {
    return { alerts: [], failures: [failure("bugsink", error)] };
  }
}

export async function collectAlertRemediationAlertsWithDeps(
  rawInput: AlertRemediationSweepInput,
  deps: AlertRemediationDeps = defaultAlertRemediationDeps,
): Promise<AlertRemediationCollectionResult> {
  const input = AlertRemediationSweepInputSchema.parse(rawInput);
  const [pagerDuty, bugsink] = await Promise.all([
    collectPagerDutyAlerts(input, deps),
    collectBugsinkAlerts(input, deps),
  ]);
  return AlertRemediationCollectionResultSchema.parse({
    alerts: [...pagerDuty.alerts, ...bugsink.alerts],
    failures: [...pagerDuty.failures, ...bugsink.failures],
  });
}

export function createAlertRemediationActivities(deps: AlertRemediationDeps) {
  return {
    async collectAlertRemediationAlerts(
      input: AlertRemediationSweepInput,
    ): Promise<AlertRemediationCollectionResult> {
      return await collectAlertRemediationAlertsWithDeps(input, deps);
    },
  };
}
