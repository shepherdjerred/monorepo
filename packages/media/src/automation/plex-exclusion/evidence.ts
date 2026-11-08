import { createHash } from "node:crypto";
import {
  PlexExclusionPlanSchema,
  PlexScanObservationSchema,
  type PlexExclusionPlan,
  type PlexScanObservation,
  type PlexSectionSnapshot,
} from "#shared/plex-exclusion.ts";

export function configurationDigest(topology: PlexSectionSnapshot): string {
  return digest({
    serverMachineId: topology.serverMachineId,
    serverVersion: topology.serverVersion,
    sectionId: topology.sectionId,
    sectionUuid: topology.sectionUuid,
    kind: topology.kind,
    scanner: topology.scanner,
    agent: topology.agent,
    locations: [...topology.locations].sort(),
  });
}
export function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function textDigest(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function exclusionPaths(
  runId: string,
  libraryRoot: string,
  kind: "movie" | "episode",
) {
  const title = `Media Exclusion ${runId}`;
  const suffix =
    kind === "movie"
      ? `${title} (2026)/${title} (2026).mkv`
      : `${title}/Season 01/${title} - S01E01.mkv`;
  return {
    positivePath: `${libraryRoot}/${suffix}`,
    negativePath: `${libraryRoot}/.media-control/probes/${runId}/${suffix}`,
  };
}

function append(before: string | null, line: string): string {
  if (before?.split(/\r?\n/u).includes(line) === true) return before;
  return `${before ?? ""}${before === null || before === "" || before.endsWith("\n") ? "" : "\n"}${line}\n`;
}

export function preparePlan(input: {
  runId: string;
  recoveryEpoch: number;
  runtimeVersion: number;
  topology: PlexSectionSnapshot;
  libraryRoot: string;
  rootMarkerBefore: string | null;
  controlMarkerBefore: string | null;
}): PlexExclusionPlan {
  return PlexExclusionPlanSchema.parse({
    ...input,
    procedureVersion: 1,
    cleanupPolicy: "owned-files-and-observed-metadata",
    controlRoot: `${input.libraryRoot}/.media-control`,
    ...exclusionPaths(input.runId, input.libraryRoot, input.topology.kind),
    rootMarkerAfter: append(input.rootMarkerBefore, ".media-control/*"),
    controlMarkerAfter: append(input.controlMarkerBefore, "*"),
    configurationDigest: configurationDigest(input.topology),
  });
}

export type ScanVerdict =
  { state: "waiting" | "intervention"; reason: string } | { state: "verified" };

/** No HTTP response/status supplied here can substitute for scanner and Part evidence. */
export function evaluateScan(input: {
  plan: PlexExclusionPlan;
  stagedAt: string;
  activityId: string | null;
  first: PlexScanObservation;
  second: PlexScanObservation;
  cleanup?: boolean;
}): ScanVerdict {
  const plan = PlexExclusionPlanSchema.parse(input.plan);
  const first = PlexScanObservationSchema.parse(input.first);
  const second = PlexScanObservationSchema.parse(input.second);
  const stagedAt = Date.parse(input.stagedAt);
  if (!Number.isFinite(stagedAt))
    throw new TypeError("Invalid probe staging time");
  const expectedPaths = exclusionPaths(
    plan.runId,
    plan.libraryRoot,
    plan.topology.kind,
  );
  if (
    plan.configurationDigest !== configurationDigest(plan.topology) ||
    plan.positivePath !== expectedPaths.positivePath ||
    plan.negativePath !== expectedPaths.negativePath
  )
    return { state: "intervention", reason: "plan_configuration_changed" };
  for (const observation of [first, second]) {
    const verdict = evaluateObservation(plan, observation, {
      stagedAt,
      activityId: input.activityId,
      cleanup: input.cleanup === true,
    });
    if (verdict.state !== "verified") return verdict;
  }
  return Date.parse(second.observedAt) - Date.parse(first.observedAt) <
    10_000 ||
    first.topology.scannedAt !== second.topology.scannedAt ||
    first.inventory.digest !== second.inventory.digest
    ? { state: "waiting", reason: "inventory_not_stable" }
    : { state: "verified" };
}

function evaluateObservation(
  plan: PlexExclusionPlan,
  observation: PlexScanObservation,
  input: { stagedAt: number; activityId: string | null; cleanup: boolean },
): ScanVerdict {
  if (configurationDigest(observation.topology) !== plan.configurationDigest)
    return { state: "intervention", reason: "plex_topology_changed" };
  if (
    observation.inventory.digest !==
    digest({
      itemCount: observation.inventory.itemCount,
      parts: observation.inventory.parts,
    })
  )
    return { state: "intervention", reason: "inventory_digest_invalid" };
  if (
    observation.topology.refreshing ||
    (input.activityId !== null &&
      observation.activeActivityIds.includes(input.activityId)) ||
    observation.topology.scannedAt <= plan.topology.scannedAt ||
    observation.topology.scannedAt <= Math.floor(input.stagedAt / 1000) ||
    Date.parse(observation.observedAt) < input.stagedAt
  )
    return { state: "waiting", reason: "scan_completion_unproven" };
  if (
    observation.inventory.parts.some(
      (part) =>
        part.path === plan.controlRoot ||
        part.path.startsWith(`${plan.controlRoot}/`),
    )
  )
    return { state: "intervention", reason: "control_path_visible_to_plex" };
  const positiveVisible = observation.inventory.parts.some(
    (part) => part.path === plan.positivePath,
  );
  if (input.cleanup ? positiveVisible : !positiveVisible)
    return {
      state: "waiting",
      reason: input.cleanup
        ? "probe_metadata_cleanup_required"
        : "positive_probe_not_visible",
    };
  return { state: "verified" };
}
