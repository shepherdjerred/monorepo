import { z } from "zod";
import {
  CapacityBootstrapSchema,
  RuntimeSchema,
  runtimeFingerprint,
} from "#capacity-runtime";
import {
  CapacityPhaseSchema,
  capacityTierVerdicts,
  totals,
  type Lifecycle,
} from "#capacity-bars";
import {
  HostDifficulty,
  CapacityBehaviorObservation,
  verifyCapacityBehavior,
  AuthoredExperienceDescription,
  authoredExperienceFromReadout,
} from "#capacity-behavior";
import { CapacityFeatureReceiptSchema } from "#capacity-features";

const Hash = z.string().regex(/^[a-f0-9]{64}$/u);
const Timestamp = z.number().int().positive();
const MapId = z.enum(["apex-expanse", "warlords-castles"]);
const Identity = z.strictObject({
  artifactSha256: Hash,
  fixtureSha256: Hash,
  personalityManifestSha256: Hash,
  botConfigSha256: Hash,
  runtimeSha256: Hash,
  personalityCount: z.literal(512),
  hostDifficulty: HostDifficulty,
  authoredExperience: AuthoredExperienceDescription,
});
const MapIdentity = z.strictObject({
  map: MapId,
  navigationSha256: Hash,
  rwfConfigSha256: Hash,
  pluginConfigSha256: Hash,
});
export const QualificationManifest = z.strictObject({
  schema: z.literal(1),
  candidate: Identity,
  maps: z.array(MapIdentity).length(2),
  reports: z.array(z.string().min(1)).min(1),
});

const Interval = z.strictObject({
  match: z.uuid().nullable(),
  startedAt: Timestamp,
  endedAt: Timestamp,
});
const Report = z.object({
  schema: z.literal(2),
  runId: z.uuid(),
  beganAt: Timestamp,
  checkpointAt: Timestamp,
  completedAt: Timestamp.optional(),
  map: MapId,
  inputs: Identity.extend({
    runtime: RuntimeSchema,
    bootstrap: CapacityBootstrapSchema,
    authoredExperienceReadout: z.string().min(1),
    features: CapacityFeatureReceiptSchema,
    containerId: z.string().regex(/^[a-f0-9]{12,64}$/u),
    computeWorkers: z.number().int().min(1).max(10),
    navigationSha256: Hash,
    rwfConfigSha256: Hash,
    pluginConfigSha256: Hash,
    enforcedLimits: z.object({
      NanoCpus: z.number().int().positive(),
      Memory: z.literal(10 * 1024 ** 3),
    }),
  }),
  resources: z.strictObject({
    cpus: z.number().int().positive(),
    heap: z.literal("8G"),
    memoryLimit: z.literal("10g"),
  }),
  rayBudget: z.literal("shipped"),
  profile: z.literal("none"),
  phases: z
    .array(
      CapacityPhaseSchema.extend({
        measurementWindows: z.array(Interval).min(1),
        matches: z.array(
          CapacityPhaseSchema.shape.matches.element.extend({
            behavior: CapacityBehaviorObservation,
          }),
        ),
      }),
    )
    .min(1)
    .max(totals.length + 1),
});
type Report = z.infer<typeof Report>;
type Manifest = z.infer<typeof QualificationManifest>;
type Source = { file: string; sha256: string; value: unknown };
const resources = [
  { cpus: 3, workers: 2 },
  { cpus: 4, workers: 3 },
  { cpus: 6, workers: 4 },
  { cpus: 8, workers: 6 },
  { cpus: 12, workers: 10 },
] as const;

function sameFields(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
) {
  return Object.entries(expected).every(
    ([key, value]) => actual[key] === value,
  );
}

function validateCandidate(manifest: Manifest, report: Report) {
  const map = manifest.maps.find((entry) => entry.map === report.map);
  if (map === undefined || !sameFields(manifest.candidate, report.inputs))
    throw new Error("Capacity evidence belongs to a different candidate");
  if (runtimeFingerprint(report.inputs.runtime) !== report.inputs.runtimeSha256)
    throw new Error("Capacity runtime details differ from their fingerprint");
  const initialGiB = report.inputs.bootstrap.initialHeap === "1G" ? 1 : 8;
  if (
    report.inputs.runtime.heap.initialBytes !== initialGiB * 1024 ** 3 ||
    report.inputs.runtime.heap.maxBytes !== 8 * 1024 ** 3
  )
    throw new Error(
      "Capacity actual JVM heap differs from its declared bootstrap",
    );
  const { map: _map, ...mapIdentity } = map;
  if (!sameFields(mapIdentity, report.inputs))
    throw new Error("Capacity map/configuration inputs changed between runs");
  if (
    report.inputs.enforcedLimits.NanoCpus !==
      report.resources.cpus * 1_000_000_000 ||
    !resources.some(
      (pair) =>
        pair.cpus === report.resources.cpus &&
        pair.workers === report.inputs.computeWorkers,
    )
  )
    throw new Error(
      "Capacity resource pair was not the declared, enforced experiment",
    );
  validateIntervals(report);
  if (
    authoredExperienceFromReadout(report.inputs.authoredExperienceReadout) !==
    report.inputs.authoredExperience
  )
    throw new Error(
      "Capacity frozen runtime settings readout differs from its candidate identity",
    );
  validateBehavior(report);
}

function validateBehavior(report: Report) {
  for (const phase of report.phases) {
    for (const match of phase.matches) {
      verifyCapacityBehavior(match.behavior.snapshot, {
        match: match.id,
        map: report.map,
        total: phase.total,
        hostDifficulty: report.inputs.hostDifficulty,
        authoredExperience: report.inputs.authoredExperience,
      });
      if (
        match.arrival.endedAt === undefined ||
        match.behavior.observedAt < match.arrival.endedAt ||
        match.behavior.observedAt >
          (report.completedAt ?? report.checkpointAt) ||
        phase.measurementWindows.some(
          (window) =>
            window.match === match.id &&
            window.startedAt < match.behavior.observedAt,
        )
      )
        throw new Error(
          "Capacity behavior was not captured after arrival and before measurement",
        );
    }
  }
}

function validateIntervals(report: Report) {
  const seen = new Set<number>();
  const allowedTotals: readonly number[] = totals;
  let previousEnd = report.beganAt;
  for (const phase of report.phases) {
    if (
      seen.has(phase.total) ||
      (phase.total !== 0 && !allowedTotals.includes(phase.total))
    )
      throw new Error("Duplicate or unknown capacity phase");
    seen.add(phase.total);
    const matches = new Set(phase.matches.map((match) => match.id));
    for (const interval of phase.measurementWindows) {
      if (
        interval.endedAt <= interval.startedAt ||
        interval.startedAt < previousEnd ||
        interval.endedAt > (report.completedAt ?? report.checkpointAt) ||
        (phase.total === 0
          ? interval.match !== null
          : interval.match === null || !matches.has(interval.match))
      )
        throw new Error(
          "Capacity measuring interval is outside its original run/match",
        );
      previousEnd = interval.endedAt;
    }
    const elapsed = phase.measurementWindows.reduce(
      (sum, interval) => sum + interval.endedAt - interval.startedAt,
      0,
    );
    if (elapsed < phase.measuredMs)
      throw new Error("Capacity intervals omit measured time");
    validateLifecycleTimes(phase, report);
  }
  validateClock(report);
}

function lifecycleClock(lifecycle: Lifecycle, report: Report) {
  const { startedAt, endedAt } = lifecycle;
  if (startedAt === undefined || endedAt === undefined)
    throw new Error("Capacity lifecycle has no original clock");
  if (
    startedAt < report.beganAt ||
    endedAt < startedAt ||
    endedAt > (report.completedAt ?? report.checkpointAt) ||
    endedAt - startedAt !== lifecycle.elapsedMs
  )
    throw new Error("Capacity lifecycle clock does not match elapsed time");
  return { startedAt, endedAt };
}

function validateLifecycleTimes(
  phase: Report["phases"][number],
  report: Report,
) {
  for (const match of phase.matches) {
    const arrival = lifecycleClock(match.arrival, report);
    const windows = phase.measurementWindows.filter(
      (interval) => interval.match === match.id,
    );
    if (
      windows.some((interval) => interval.startedAt < arrival.endedAt + 20_000)
    )
      throw new Error("Capacity match omitted the settling period");
    if (match.reset === undefined) continue; // Raw bars reject unfinished cleanup.
    const reset = lifecycleClock(match.reset, report);
    if (
      match.resetMs !== match.reset.elapsedMs ||
      reset.startedAt < arrival.endedAt ||
      windows.some((interval) => interval.endedAt > reset.startedAt)
    )
      throw new Error("Capacity reset did not follow original measurements");
  }
}

function validateClock(report: Report) {
  if (
    report.inputs.features.configuredAt > report.beganAt ||
    report.checkpointAt < report.beganAt ||
    (report.completedAt !== undefined &&
      (report.completedAt < report.beganAt ||
        report.completedAt > report.checkpointAt))
  )
    throw new Error("Invalid capacity run clock");
}

/** Recompute raw bars; supplied summaries and pass labels are never acceptance evidence. */
export function qualifyCapacity(rawManifest: unknown, sources: Source[]) {
  const manifest = QualificationManifest.parse(rawManifest);
  if (new Set(manifest.maps.map((map) => map.map)).size !== 2)
    throw new Error("Both independent acceptance maps are required");
  if (
    manifest.reports.length !== sources.length ||
    manifest.reports.some((file, index) => sources[index]?.file !== file)
  )
    throw new Error(
      "Qualification did not read the complete declared evidence set",
    );
  const reports = sources.map((source) => Report.parse(source.value));
  sources.forEach((source) => {
    Hash.parse(source.sha256);
  });
  const identities = [
    sources.map((source) => source.file),
    sources.map((source) => source.sha256),
    reports.map((report) => report.runId),
    reports.map((report) => report.inputs.containerId),
    reports.flatMap((report) =>
      report.phases.flatMap((phase) => phase.matches.map((match) => match.id)),
    ),
  ];
  if (identities.some((values) => new Set(values).size !== values.length))
    throw new Error(
      "Duplicate report, run, container or match cannot count as a repetition",
    );
  reports.forEach((report) => {
    validateCandidate(manifest, report);
  });
  const overlapping = new Set<string>();
  for (let i = 0; i < reports.length; i++) {
    const left = reports[i];
    if (left === undefined) throw new Error("Missing original report");
    for (const right of reports.slice(i + 1)) {
      if (
        left.beganAt < (right.completedAt ?? right.checkpointAt) &&
        right.beganAt < (left.completedAt ?? left.checkpointAt)
      ) {
        overlapping.add(left.runId);
        overlapping.add(right.runId);
      }
    }
  }
  const pairs = resources.map((pair) => {
    const selected = reports.filter(
      (report) =>
        report.resources.cpus === pair.cpus &&
        report.inputs.computeWorkers === pair.workers,
    );
    const tiers = totals.map((total) => {
      const maps = manifest.maps.map(({ map }) => {
        const runs = selected.filter(
          (report) =>
            report.map === map &&
            report.phases.some((phase) => phase.total === total),
        );
        const results = runs.map((run) => ({
          runId: run.runId,
          complete: run.completedAt !== undefined,
          isolated: !overlapping.has(run.runId),
          verdicts: capacityTierVerdicts(run.phases, total),
        }));
        return {
          map,
          repetitions: runs.length,
          passed:
            runs.length === 2 &&
            results.every(
              (result) =>
                result.complete &&
                result.isolated &&
                result.verdicts.every((verdict) => verdict.pass),
            ),
          results,
        };
      });
      return { total, loadQualified: maps.every((map) => map.passed), maps };
    });
    const best = tiers.findLast(
      (tier) => tier.loadQualified && [64, 128, 256].includes(tier.total),
    );
    return {
      ...pair,
      loadQualifiedTier: best?.total ?? null,
      fullMatrixPassed: tiers.every((tier) => tier.loadQualified),
      tiers,
    };
  });
  const bestTier = Math.max(
    0,
    ...pairs.map((pair) => pair.loadQualifiedTier ?? 0),
  );
  const recommended = pairs.find((pair) => pair.loadQualifiedTier === bestTier);
  return {
    schema: 1,
    kind: "rwf-capacity-matrix-qualification",
    candidate: manifest.candidate,
    behaviorLabel: `HOST_${manifest.candidate.hostDifficulty}`,
    evidence: sources.map(({ file, sha256 }) => ({ file, sha256 })),
    pairs,
    recommendation:
      recommended === undefined
        ? null
        : {
            total: bestTier,
            cpus: recommended.cpus,
            workers: recommended.workers,
          },
    deploymentAccepted: false,
    remainingGates: [
      "rendered native combat",
      "bounded lazy loading",
      "survival coexistence",
      "MacBook frame pacing",
      "manual gameplay quality",
      "cluster capacity",
      "production rollout and live acceptance",
    ],
  };
}
