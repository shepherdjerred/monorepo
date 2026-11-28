/**
 * Scenarios run against both repositories (in-memory in the unit tier,
 * PostgreSQL in the extended tier) with one expected result, so the two
 * implementations cannot drift on signal ordering or open-listing priority.
 */
import {
  DeclareIncidentInputSchema,
  IncidentSignalInputSchema,
} from "#shared/contract.ts";
import type { Harness } from "#testing/hub.ts";
import { AGENT } from "#testing/hub.ts";
import { minutes } from "#testing/records.ts";

type Report = {
  readonly key: string;
  readonly system: "main-ci" | "delivery" | "tracker" | "argocd";
  readonly at: number;
  readonly firing: boolean;
};

function parsed(report: Report) {
  return IncidentSignalInputSchema.parse({
    source: report.key.startsWith("main-ci") ? "main-ci" : "alertmanager",
    key: report.key,
    firing: report.firing,
    system: report.system,
    severity: "sev2",
    title: `${report.system} signal`,
    exitCondition: "The signal clears.",
    observedAt: minutes(report.at).toISOString(),
  });
}

/** Retries, clear-before-fire, a repeated firing, and an equal-timestamp tie. */
const REPORTS: readonly Report[] = [
  { key: "main-ci:main", system: "main-ci", at: 0, firing: true },
  { key: "main-ci:main", system: "main-ci", at: 5, firing: false },
  { key: "main-ci:main", system: "main-ci", at: 0, firing: true },
  { key: "fp-delivery", system: "delivery", at: 5, firing: false },
  { key: "fp-delivery", system: "delivery", at: 0, firing: true },
  { key: "fp-tracker", system: "tracker", at: 0, firing: true },
  { key: "fp-tracker", system: "tracker", at: 10, firing: true },
  { key: "fp-tracker", system: "tracker", at: 5, firing: false },
  { key: "fp-argocd", system: "argocd", at: 7, firing: true },
  { key: "fp-argocd", system: "argocd", at: 7, firing: false },
];

export const WATERMARK_SCENARIO_EXPECTED = {
  results: [
    ["main-ci:main", "opened", "INC-1"],
    ["main-ci:main", "auto-resolved", "INC-1"],
    ["main-ci:main", "ignored", null],
    ["fp-delivery", "ignored", null],
    ["fp-delivery", "ignored", null],
    ["fp-tracker", "opened", "INC-2"],
    ["fp-tracker", "ignored", "INC-2"],
    ["fp-tracker", "ignored", "INC-2"],
    ["fp-argocd", "opened", "INC-3"],
    ["fp-argocd", "ignored", "INC-3"],
  ],
  incidents: [
    ["INC-1", "resolved"],
    ["INC-2", "investigating"],
    ["INC-3", "investigating"],
  ],
  watermarks: [
    ["main-ci:main", 5, false, 1],
    ["fp-delivery", 5, false, 0],
    ["fp-tracker", 10, true, 1],
    ["fp-argocd", 7, true, 0],
  ],
} as const;

export async function runWatermarkScenario(h: Harness) {
  const results: (string | null)[][] = [];
  for (const report of REPORTS) {
    h.clock.now = minutes(report.at);
    const batch = await h.server.service.applySignals([parsed(report)]);
    for (const result of batch.results)
      results.push([result.key, result.outcome, result.identifier]);
  }
  const all = await h.server.service.list({ state: "all", limit: 50 });
  const incidents = all
    .map((incident) => [incident.identifier, incident.status])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const watermarks: (string | number | boolean)[][] = [];
  for (const key of [
    "main-ci:main",
    "fp-delivery",
    "fp-tracker",
    "fp-argocd",
  ]) {
    const source = key.startsWith("main-ci") ? "main-ci" : "alertmanager";
    const watermark = await h.repository.findSignalWatermark(source, key);
    if (watermark === null) throw new Error(`no watermark for ${key}`);
    watermarks.push([
      key,
      (watermark.lastObservedAt.getTime() - minutes(0).getTime()) / 60_000,
      watermark.firing,
      watermark.revision,
    ]);
  }
  return { results, incidents, watermarks };
}

/** Many concurrent reports for one key: one incident, and the watermark ends at the newest. */
export async function runWatermarkRace(h: Harness) {
  const reports = Array.from({ length: 10 }, (_, index) =>
    parsed({ key: "fp-race", system: "delivery", at: index + 1, firing: true }),
  );
  const batches = await Promise.all(
    reports.map((report) => h.server.service.applySignals([report])),
  );
  const outcomes = batches.flatMap((batch) =>
    batch.results.map((r) => r.outcome),
  );
  const watermark = await h.repository.findSignalWatermark(
    "alertmanager",
    "fp-race",
  );
  const open = await h.server.service.list({ state: "open", limit: 50 });
  return {
    opened: outcomes.filter((outcome) => outcome === "opened").length,
    ignored: outcomes.filter((outcome) => outcome === "ignored").length,
    lastObservedAt: watermark?.lastObservedAt.toISOString(),
    open: open.length,
  };
}

export const WATERMARK_RACE_EXPECTED = {
  opened: 1,
  ignored: 9,
  lastObservedAt: minutes(10).toISOString(),
  open: 1,
};

/** An older sev1 must not be hidden behind newer, less severe incidents by `limit`. */
export async function runPriorityScenario(h: Harness) {
  const declare = async (severity: string, system: string, at: number) => {
    h.clock.now = minutes(at);
    await h.server.service.declare(
      DeclareIncidentInputSchema.parse({
        actor: AGENT,
        title: `${system} incident`,
        severity,
        systems: [system],
        exitCondition: "Recovered.",
      }),
    );
  };
  await declare("sev1", "delivery", 0);
  await declare("sev3", "tracker", 1);
  await declare("sev2", "argocd", 2);
  await declare("sev3", "network", 3);
  const ids = async (state: "open" | "all", limit: number) => {
    const listed = await h.server.service.list({ state, limit });
    return listed.map((incident) => incident.identifier);
  };
  return {
    openOne: await ids("open", 1),
    openTwo: await ids("open", 2),
    openAll: await ids("open", 50),
    allTwo: await ids("all", 2),
  };
}

export const PRIORITY_SCENARIO_EXPECTED = {
  openOne: ["INC-1"],
  openTwo: ["INC-1", "INC-3"],
  openAll: ["INC-1", "INC-3", "INC-4", "INC-2"],
  allTwo: ["INC-4", "INC-3"],
};
