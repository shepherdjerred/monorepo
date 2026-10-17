import { z } from "zod";
import type { Database } from "#infrastructure/database.ts";
import {
  PlexExclusionPlanSchema,
  PlexSectionSnapshotSchema,
  type PlexExclusionFileActivities,
} from "#shared/plex-exclusion.ts";
import {
  prepareProbeVideo,
  readExclusionMarkers,
  stageExclusionProbe,
  cleanupExclusionProbe,
  requireMarkers,
} from "#filesystem/plex-exclusion-probe.ts";
import { digest, preparePlan } from "./evidence.ts";
import {
  assertRunAuthority,
  lockedRun,
  RunJournalSchema,
  saveRun,
} from "./state.ts";

export function createPlexExclusionFileActivities(context: {
  db: Database;
  roots: { movies: string; tv: string };
  checkpoint: () => Promise<void>;
}): PlexExclusionFileActivities {
  return {
    async preparePlexExclusionFiles(input) {
      const initial = await context.db.plexExclusionRun.findUniqueOrThrow({
        where: { id: input.runId },
      });
      if (initial.state === "prepared") return;
      if (initial.state !== "topology_prepared")
        throw new Error("Plex topology is not prepared");
      const target = z
        .object({
          kind: z.enum(["movies", "tv"]),
          topology: PlexSectionSnapshotSchema,
        })
        .parse(initial.plan);
      const libraryRoot = context.roots[target.kind];
      const markers = await readExclusionMarkers(libraryRoot);
      const files = await prepareProbeVideo(initial.id);
      const plan = preparePlan({
        runId: initial.id,
        recoveryEpoch: initial.recoveryEpoch,
        runtimeVersion: initial.runtimeVersion,
        libraryRoot,
        topology: target.topology,
        ...markers,
      });
      await lockedRun(context.db, input, async (tx, run) => {
        if (run.state === "prepared") return;
        if (
          run.state !== "topology_prepared" ||
          run.version !== initial.version
        )
          throw new Error("Plex preparation changed");
        await tx.plexExclusionRun.update({
          where: { id: run.id },
          data: {
            plan,
            planDigest: digest(plan),
            journal: { files },
            state: "prepared",
            version: { increment: 1 },
          },
        });
        await tx.operation.update({
          where: { id: input.operationId },
          data: { status: "completed", result: { runId: run.id } },
        });
      });
    },
    async stagePlexExclusionFiles(input) {
      await lockedRun(context.db, input, async (tx, run) => {
        if (
          [
            "staged",
            "scanning",
            "probe_verified",
            "cleaned",
            "cleanup_scanning",
            "verified",
          ].includes(run.state)
        )
          return;
        if (run.state !== "approved")
          throw new Error("Plex exclusion plan is not approved");
        const plan = PlexExclusionPlanSchema.parse(run.plan);
        let journal = RunJournalSchema.parse(run.journal);
        if (
          run.planDigest !== digest(plan) ||
          journal.files === undefined ||
          journal.topologyCheckedAt === undefined ||
          Date.now() - Date.parse(journal.topologyCheckedAt) > 60_000
        )
          throw new Error("Plex exclusion preparation is stale");
        const files = await stageExclusionProbe(plan, journal.files, {
          authorize: () => assertRunAuthority(tx, run, input.operationId),
          checkpoint: context.checkpoint,
          save: async (value) => {
            journal = { ...journal, files: value };
            await saveRun(tx, run.id, journal, "approved");
          },
        });
        await saveRun(tx, run.id, { ...journal, files }, "staged");
      });
    },
    async cleanupPlexExclusionFiles(input) {
      await lockedRun(context.db, input, async (tx, run) => {
        if (["cleaned", "cleanup_scanning", "verified"].includes(run.state))
          return;
        const plan = PlexExclusionPlanSchema.parse(run.plan);
        let journal = RunJournalSchema.parse(run.journal);
        if (journal.files === undefined)
          throw new Error("Plex probe ownership evidence is missing");
        const files = await cleanupExclusionProbe(plan, journal.files, {
          authorize: () => assertRunAuthority(tx, run, input.operationId),
          checkpoint: context.checkpoint,
          save: async (value) => {
            journal = { ...journal, files: value };
            await saveRun(tx, run.id, journal, run.state);
          },
        });
        await requireMarkers(plan);
        await saveRun(tx, run.id, { ...journal, files }, "cleaned");
      });
    },
  };
}
