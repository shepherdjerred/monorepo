import type { Database } from "#infrastructure/database.ts";
import {
  preparePlan,
  digest,
  textDigest,
} from "#automation/plex-exclusion/evidence.ts";
import { requirePlexExclusionDatabaseProof } from "#automation/plex-exclusion/proof.ts";
import type { PlexExclusionPlan } from "#shared/plex-exclusion.ts";

/** Synthetic scanner observations for disposable DB tests; the production validator remains active. */
export async function grantTestExclusionProofs(db: Database, ownerId: string) {
  const runtime = await db.mediaRuntimeState.findUniqueOrThrow({
    where: { id: "singleton" },
  });
  const plans = [];
  for (const kind of ["movie", "episode"] as const) {
    const libraryRoot = kind === "movie" ? "/data/movies" : "/data/tv";
    const now = Date.now();
    const plan = preparePlan({
      runId: crypto.randomUUID(),
      recoveryEpoch: runtime.recoveryEpoch,
      runtimeVersion: runtime.version,
      libraryRoot,
      rootMarkerBefore: null,
      controlMarkerBefore: null,
      topology: {
        serverMachineId: "server",
        serverVersion: "synthetic-fixture",
        sectionId: kind === "movie" ? "1" : "2",
        sectionUuid: `section-${kind}`,
        kind,
        scanner: "synthetic",
        agent: "synthetic",
        locations: [libraryRoot],
        scannedAt: 1,
        refreshing: false,
      },
    });
    const planDigest = digest(plan);
    const evidence = {
      procedureVersion: 1,
      planDigest,
      probeSha256: textDigest("synthetic-probe"),
      rootMarkerSha256: textDigest(plan.rootMarkerAfter),
      controlMarkerSha256: textDigest(plan.controlMarkerAfter),
      stagedAt: new Date(now - 60_000).toISOString(),
      scanRequestedAt: new Date(now - 59_000).toISOString(),
      activityId: null,
      first: scan(plan, {
        observedAt: now - 40_000,
        scannedAt: now - 50_000,
        visible: true,
      }),
      second: scan(plan, {
        observedAt: now - 30_000,
        scannedAt: now - 50_000,
        visible: true,
      }),
      filesCleanedAt: new Date(now - 25_000).toISOString(),
      topologyCheckedAt: new Date(now).toISOString(),
      cleanup: {
        state: "verified",
        activityId: null,
        requestedAt: new Date(now - 24_000).toISOString(),
        first: scan(plan, {
          observedAt: now - 15_000,
          scannedAt: now - 20_000,
          visible: false,
        }),
        second: scan(plan, {
          observedAt: now - 5000,
          scannedAt: now - 20_000,
          visible: false,
        }),
      },
    };
    await db.plexExclusionRun.create({
      data: {
        id: plan.runId,
        ownerId,
        state: "verified",
        recoveryEpoch: runtime.recoveryEpoch,
        runtimeVersion: runtime.version,
        planDigest,
        plan,
        journal: {},
      },
    });
    await db.plexExclusionProof.create({
      data: {
        runId: plan.runId,
        serverMachineId: plan.topology.serverMachineId,
        serverVersion: plan.topology.serverVersion,
        sectionId: plan.topology.sectionId,
        sectionUuid: plan.topology.sectionUuid,
        libraryRoot,
        controlRoot: plan.controlRoot,
        rootMarkerSha256: evidence.rootMarkerSha256,
        controlMarkerSha256: evidence.controlMarkerSha256,
        configurationDigest: plan.configurationDigest,
        recoveryEpoch: runtime.recoveryEpoch,
        evidence,
        verifiedAt: new Date(now),
      },
    });
    await requirePlexExclusionDatabaseProof(db, {
      library: libraryRoot,
      control: plan.controlRoot,
    });
    plans.push(plan);
  }
  return plans;
}
function scan(
  plan: PlexExclusionPlan,
  input: { observedAt: number; scannedAt: number; visible: boolean },
) {
  const inventory = {
    itemCount: input.visible ? 1 : 0,
    parts: input.visible
      ? [{ ratingKey: "99", partId: 1, path: plan.positivePath }]
      : [],
  };
  return {
    topology: {
      ...plan.topology,
      scannedAt: Math.floor(input.scannedAt / 1000),
    },
    inventory: { ...inventory, digest: digest(inventory) },
    observedAt: new Date(input.observedAt).toISOString(),
    activeActivityIds: [],
  };
}
