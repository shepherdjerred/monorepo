import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import type { PlexMaintenanceClient } from "#integrations/plex-maintenance.ts";
import { IntegrationError } from "#integrations/http.ts";
import {
  PlexExclusionPlanSchema,
  PlexExclusionEvidenceSchema,
  type PlexExclusionNetworkActivities,
  type PlexExclusionOperation,
  type PlexExclusionPlan,
  type PlexScanObservation,
} from "#shared/plex-exclusion.ts";
import {
  configurationDigest,
  digest,
  evaluateScan,
  textDigest,
} from "./evidence.ts";
import {
  lockedRun,
  RunJournalSchema,
  saveRun,
  type RunJournal,
} from "./state.ts";

type Context = {
  db: Database;
  plex: PlexMaintenanceClient;
  machineId: string;
  permittedSections: () => Promise<{ movie: string; series: string }>;
  checkpoint: () => Promise<void>;
  now?: () => Date;
};
function now(context: Context): Date {
  return context.now?.() ?? new Date();
}

export function createPlexExclusionNetworkActivities(
  context: Context,
): PlexExclusionNetworkActivities {
  return {
    async preparePlexExclusionTopology(input) {
      const initial = await context.db.plexExclusionRun.findUniqueOrThrow({
        where: { id: input.runId },
      });
      if (initial.state !== "preparing") return;
      const target = z
        .object({ kind: z.enum(["movies", "tv"]) })
        .parse(initial.plan);
      const permitted = await context.permittedSections();
      const topology = await context.plex.topology(
        target.kind === "movies" ? permitted.movie : permitted.series,
      );
      if (
        topology.serverMachineId !== context.machineId ||
        topology.kind !== (target.kind === "movies" ? "movie" : "episode") ||
        topology.refreshing
      )
        throw new Error("Plex target is not the configured idle library");
      await lockedRun(context.db, input, async (tx, run) => {
        if (run.state !== "preparing") return;
        await tx.plexExclusionRun.update({
          where: { id: run.id },
          data: {
            plan: { kind: target.kind, topology },
            state: "topology_prepared",
            version: { increment: 1 },
          },
        });
      });
    },
    async validatePlexExclusionExecution(input) {
      const run = await context.db.plexExclusionRun.findUniqueOrThrow({
        where: { id: input.runId },
      });
      const plan = PlexExclusionPlanSchema.parse(run.plan);
      await requireTopology(context, plan);
      await lockedRun(context.db, input, async (tx, latest) => {
        if (latest.planDigest !== digest(plan))
          throw new Error("Plex plan digest changed");
        await saveRun(
          tx,
          latest.id,
          {
            ...RunJournalSchema.parse(latest.journal),
            topologyCheckedAt: now(context).toISOString(),
          },
          latest.state,
        );
      });
    },
    reconcilePlexExclusionScan: (input) => reconcile(context, input),
    async recordPlexExclusionIntervention(input) {
      await context.db.$transaction(async (tx) => {
        const run = await tx.plexExclusionRun.findUniqueOrThrow({
          where: { id: input.runId },
        });
        const operation = await tx.operation.findUniqueOrThrow({
          where: { id: input.operationId },
        });
        if (operation.targetId !== run.id || operation.userId !== run.ownerId)
          throw new Error("Plex intervention operation mismatch");
        if (run.state === "verified") return;
        await saveRun(
          tx,
          run.id,
          {
            ...RunJournalSchema.parse(run.journal),
            reason: "execution_interrupted_review_journal_before_resuming",
          },
          "intervention",
        );
        await tx.operation.update({
          where: { id: input.operationId },
          data: {
            status: "reconciling",
            result: { reason: "plex_exclusion_intervention" },
          },
        });
      });
    },
    async finishPlexExclusion(input) {
      const initial = await context.db.plexExclusionRun.findUniqueOrThrow({
        where: { id: input.runId },
      });
      const plan = PlexExclusionPlanSchema.parse(initial.plan);
      await requireTopology(context, plan);
      await lockedRun(context.db, input, async (tx, run) => {
        const journal = RunJournalSchema.parse(run.journal);
        if (run.state === "verified") return;
        if (
          journal.scan?.state !== "verified" ||
          journal.cleanupScan?.state !== "verified" ||
          journal.files?.cleanedAt == null ||
          !journal.files.positiveRemoved ||
          !journal.files.negativeRemoved ||
          journal.evidence === undefined
        ) {
          await saveRun(
            tx,
            run.id,
            { ...journal, reason: "exclusion_or_cleanup_not_verified" },
            "intervention",
          );
          await tx.operation.update({
            where: { id: input.operationId },
            data: {
              status: "reconciling",
              result: { reason: "exclusion_or_cleanup_not_verified" },
            },
          });
          return;
        }
        const evidence = PlexExclusionEvidenceSchema.parse(journal.evidence);
        if (
          evaluateScan({
            plan,
            stagedAt: evidence.stagedAt,
            activityId: evidence.activityId,
            first: evidence.first,
            second: evidence.second,
          }).state !== "verified"
        )
          throw new Error("Plex exclusion evidence does not verify");
        await tx.plexExclusionProof.upsert({
          where: { runId: run.id },
          create: {
            runId: run.id,
            serverMachineId: plan.topology.serverMachineId,
            serverVersion: plan.topology.serverVersion,
            sectionId: plan.topology.sectionId,
            sectionUuid: plan.topology.sectionUuid,
            libraryRoot: plan.libraryRoot,
            controlRoot: plan.controlRoot,
            rootMarkerSha256: evidence.rootMarkerSha256,
            controlMarkerSha256: evidence.controlMarkerSha256,
            configurationDigest: plan.configurationDigest,
            recoveryEpoch: run.recoveryEpoch,
            evidence: {
              ...evidence,
              cleanup: journal.cleanupScan,
              topologyCheckedAt: now(context).toISOString(),
              filesCleanedAt: journal.files.cleanedAt,
            },
            verifiedAt: now(context),
          },
          update: {},
        });
        await saveRun(tx, run.id, journal, "verified");
        await tx.operation.update({
          where: { id: input.operationId },
          data: { status: "completed", result: { runId: run.id } },
        });
      });
    },
  };
}

async function requireTopology(
  context: Context,
  plan: PlexExclusionPlan,
): Promise<void> {
  const current = await context.plex.topology(plan.topology.sectionId);
  const permitted = await context.permittedSections();
  if (
    current.serverMachineId !== context.machineId ||
    configurationDigest(current) !== plan.configurationDigest ||
    current.sectionId !==
      (plan.topology.kind === "movie" ? permitted.movie : permitted.series)
  )
    throw new Error("Plex topology no longer matches the reviewed plan");
}

async function reconcile(
  context: Context,
  input: PlexExclusionOperation & { cleanup: boolean },
) {
  const key = input.cleanup ? "cleanupScan" : "scan";
  const initialize = await lockedRun(context.db, input, async (tx, run) => {
    const journal = RunJournalSchema.parse(run.journal);
    const plan = PlexExclusionPlanSchema.parse(run.plan);
    const files = journal.files;
    const completedAt = input.cleanup ? files?.cleanedAt : files?.stagedAt;
    if (completedAt == null)
      throw new Error("Plex probes are not ready for scan");
    if (journal[key] !== undefined) return { send: false, defer: false, plan };
    // Plex exposes whole seconds. Never issue the scan in the second during
    // which either probe was still being created (or removed).
    if (
      Math.floor(now(context).getTime() / 1000) <=
      Math.floor(Date.parse(completedAt) / 1000)
    )
      return { send: false, defer: true, plan };
    await saveRun(
      tx,
      run.id,
      {
        ...journal,
        [key]: {
          requestedAt: now(context).toISOString(),
          activityId: null,
          first: null,
          second: null,
          state: "sending",
          reason: null,
        },
      },
      input.cleanup ? "cleanup_scanning" : "scanning",
    );
    return { send: true, defer: false, plan };
  });
  if (initialize.defer)
    return {
      state: "waiting" as const,
      reason: "awaiting_scan_timestamp_boundary",
    };
  if (initialize.send) await sendScan(context, input, initialize.plan);
  const observation = await collectObservation(context, initialize.plan);
  if (input.cleanup)
    await cleanupMetadata(context, input, initialize.plan, observation);
  return await lockedRun(context.db, input, async (tx, run) => {
    let journal = RunJournalSchema.parse(run.journal);
    const scan = journal[key];
    const files = journal.files;
    if (scan === undefined || files === undefined)
      throw new Error("Plex scan journal missing");
    if (scan.state === "verified" || scan.state === "intervention")
      return { state: scan.state, reason: scan.reason };
    const first = scan.first ?? observation;
    const stagedAt = input.cleanup ? files.cleanedAt : files.stagedAt;
    if (stagedAt === null) throw new Error("Plex staging timestamp missing");
    const verdict = evaluateScan({
      plan: initialize.plan,
      stagedAt,
      activityId: scan.activityId,
      first,
      second: observation,
      cleanup: input.cleanup,
    });
    const deadlineStart =
      input.cleanup && journal.recoveryStartedAt !== undefined
        ? journal.recoveryStartedAt
        : scan.requestedAt;
    const expired =
      now(context).getTime() - Date.parse(deadlineStart) > 10 * 60_000;
    const state =
      expired && verdict.state === "waiting" ? "intervention" : verdict.state;
    const reason = verdict.state === "verified" ? null : verdict.reason;
    journal = {
      ...journal,
      [key]: {
        ...scan,
        first: state === "waiting" ? observation : first,
        second: observation,
        state,
        reason,
      },
    };
    if (state === "verified" && !input.cleanup)
      journal = {
        ...journal,
        evidence: makeEvidence(initialize.plan, journal),
      };
    await saveRun(
      tx,
      run.id,
      journal,
      nextRunState(state, input.cleanup, run.state),
    );
    return { state, reason };
  });
}

function nextRunState(
  state: string,
  cleanup: boolean,
  previous: string,
): string {
  if (state === "verified") return cleanup ? "cleaned" : "probe_verified";
  return state === "intervention" ? "intervention" : previous;
}

async function sendScan(
  context: Context,
  input: PlexExclusionOperation & { cleanup: boolean },
  plan: PlexExclusionPlan,
): Promise<void> {
  await requireTopology(context, plan);
  await lockedRun(context.db, input, async (tx, run) => {
    const journal = RunJournalSchema.parse(run.journal);
    const key = input.cleanup ? "cleanupScan" : "scan";
    const scan = journal[key];
    if (scan?.state !== "sending") return;
    let activityId: string | null = null;
    let reason: string | null = null;
    try {
      const accepted = await context.plex.scanRoot(
        plan.topology,
        plan.libraryRoot,
      );
      activityId = accepted.activityId;
    } catch (error) {
      if (!(error instanceof IntegrationError)) throw error;
      reason = `scan_${error.kind}`;
    }
    await saveRun(
      tx,
      run.id,
      { ...journal, [key]: { ...scan, activityId, reason, state: "waiting" } },
      run.state,
    );
  });
}

async function collectObservation(
  context: Context,
  plan: PlexExclusionPlan,
): Promise<PlexScanObservation> {
  const before = await context.plex.topology(plan.topology.sectionId);
  const inventory = await context.plex.inventory(before, context.checkpoint);
  const after = await context.plex.topology(plan.topology.sectionId);
  if (
    configurationDigest(before) !== configurationDigest(after) ||
    before.scannedAt !== after.scannedAt ||
    before.refreshing !== after.refreshing
  )
    throw new Error("Plex scan changed during inventory; reconcile again");
  return {
    topology: after,
    inventory,
    observedAt: now(context).toISOString(),
    activeActivityIds: await context.plex.activities(),
  };
}

function makeEvidence(plan: PlexExclusionPlan, journal: RunJournal) {
  const scan = journal.scan;
  const files = journal.files;
  if (
    scan?.first === undefined ||
    scan.second === null ||
    files?.stagedAt === null
  )
    throw new Error("Plex proof evidence missing");
  return PlexExclusionEvidenceSchema.parse({
    procedureVersion: 1,
    planDigest: digest(plan),
    probeSha256: files?.probeSha256,
    rootMarkerSha256: textDigest(plan.rootMarkerAfter),
    controlMarkerSha256: textDigest(plan.controlMarkerAfter),
    stagedAt: files?.stagedAt,
    scanRequestedAt: scan.requestedAt,
    activityId: scan.activityId,
    first: scan.first,
    second: scan.second,
  });
}

async function cleanupMetadata(
  context: Context,
  input: PlexExclusionOperation,
  plan: PlexExclusionPlan,
  observation: PlexScanObservation,
): Promise<void> {
  const ownedPaths = [plan.positivePath, plan.negativePath];
  const keys = [
    ...new Set(
      observation.inventory.parts
        .filter((part) => ownedPaths.includes(part.path))
        .map((part) => part.ratingKey),
    ),
  ];
  if (keys.length > 2)
    throw new Error("Unexpected duplicate Plex probe metadata requires review");
  for (const ratingKey of keys) {
    const review = await context.plex.inspectProbeMetadata(
      ratingKey,
      ownedPaths,
    );
    await lockedRun(context.db, input, async (tx, run) => {
      const journal = RunJournalSchema.parse(run.journal);
      if (
        journal.files?.positiveRemoved !== true ||
        !journal.files.negativeRemoved ||
        journal.files.cleanedAt === null
      )
        throw new Error("Probe files must be removed before metadata cleanup");
      await saveRun(
        tx,
        run.id,
        {
          ...journal,
          cleanupReview: { ...journal.cleanupReview, [ratingKey]: review },
        },
        run.state,
      );
    });
  }
}
