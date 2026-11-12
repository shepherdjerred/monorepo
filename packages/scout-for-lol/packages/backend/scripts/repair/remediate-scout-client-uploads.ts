/**
 * Remediate data uploaded by one Scout desktop client owner or device.
 *
 *   bun run scripts/repair/remediate-scout-client-uploads.ts --owner <userId>
 *   bun run scripts/repair/remediate-scout-client-uploads.ts --device <deviceId> --apply
 *
 * Without `--apply` this prints the plan and changes nothing. Run it with the
 * production database and object-store environment; the Temporal steps go
 * through `toolkit temporal`. See the wiki how-to "Remediate Scout client
 * uploads".
 */
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { prisma } from "#src/database/index.ts";
import configuration from "#src/configuration.ts";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  fetchMatchData,
  fetchMatchTimeline,
} from "#src/league/tasks/postmatch/match-data-fetcher.ts";
import { platformRouteOf } from "#src/durable/match/match-identity.ts";
import {
  recordMatchForReportStore,
  recordTimelineForReportStore,
} from "#src/report-store/live-ingest.ts";
import { requestFullHallBaseline } from "#src/progression/hall/settings.ts";
import { revokeDevice } from "#src/scout-client/pairing.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import {
  SCOUT_WORKFLOW_NAMES,
  scoutHallBaselineWorkflowId,
  scoutTaskQueues,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import {
  applyRemediationPlan,
  buildRemediationPlan,
  formatRemediationPlan,
  parseRemediationArgs,
  type RemediationDeps,
} from "#src/scout-client/remediation/remediation.ts";

const SOURCE = "scout_client_remediation";
const ACTOR = "scout-client-remediation";

function stage(): ScoutStage {
  const value = configuration.environment;
  if (value !== "beta" && value !== "prod") {
    throw new Error(`Remediation targets beta or prod, not ${value}`);
  }
  return value;
}

/** Run a workflow to completion through the operator's `toolkit temporal`. */
async function executeWorkflow(args: {
  readonly type: string;
  readonly workflowId: string;
  readonly input: unknown;
}): Promise<void> {
  const target = stage();
  const process = Bun.spawn(
    [
      "toolkit",
      "temporal",
      "--namespace",
      target,
      "workflow",
      "execute",
      "--type",
      args.type,
      "--task-queue",
      scoutTaskQueues(target).workflow,
      "--workflow-id",
      args.workflowId,
      "--input",
      JSON.stringify(args.input),
    ],
    { stdout: "inherit", stderr: "inherit" },
  );
  const code = await process.exited;
  if (code !== 0) {
    throw new Error(
      `${args.type} ${args.workflowId} exited with ${code.toString()}`,
    );
  }
}

function runId(): string {
  return new Date().toISOString().replaceAll(/[-:.]/g, "").slice(0, 15);
}

const { scope, apply } = parseRemediationArgs(Bun.argv.slice(2));
const bucket = configuration.s3BucketName;
const s3 = createS3Client();

const deps: RemediationDeps = {
  riot: {
    fetchMatch: (matchId) =>
      fetchMatchData(
        matchId,
        platformRouteOf(matchId),
        "return_undefined_on_404",
      ),
    fetchTimeline: (matchId) =>
      fetchMatchTimeline(
        matchId,
        platformRouteOf(matchId),
        "return_undefined_on_404",
      ),
  },
  objects: {
    delete: async (key) => {
      if (bucket === undefined) throw new Error("S3_BUCKET_NAME is not set");
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
  },
  ingestMatch: async (match, trackedPlayerAliases) => {
    await recordMatchForReportStore({
      match,
      source: SOURCE,
      trackedPlayerAliases,
    });
  },
  ingestTimeline: async (timeline, trackedPlayerAliases, gameCreatedAt) => {
    await recordTimelineForReportStore({
      timeline,
      source: SOURCE,
      trackedPlayerAliases,
      gameCreatedAt,
    });
  },
  revokeDevice: (deviceId, ownerId) =>
    revokeDevice(deviceId, DiscordAccountIdSchema.parse(ownerId)),
  refresh: {
    // The workflows the schedules run, executed to completion in order so the
    // Hall baselines read the rebuilt lake.
    rebuildLake: () =>
      executeWorkflow({
        type: SCOUT_WORKFLOW_NAMES.reportLake,
        workflowId: `scout-${stage()}-report-lake-remediation-${runId()}`,
        input: { stage: stage(), kind: "rebuild" },
      }),
    refreshHallOfFame: async () => {
      const guilds = await prisma.hallSettings.findMany({
        select: { guildId: true },
      });
      for (const { guildId } of guilds) {
        const request = await requestFullHallBaseline(prisma, {
          guildId: DiscordGuildIdSchema.parse(guildId),
          actorDiscordId: ACTOR,
          stage: stage(),
          reuseActive: false,
        });
        if (request === null) continue;
        await executeWorkflow({
          type: SCOUT_WORKFLOW_NAMES.hallBaseline,
          workflowId: scoutHallBaselineWorkflowId(
            stage(),
            request.guildId,
            request.revision,
          ),
          input: {
            stage: stage(),
            guildId: request.guildId,
            revision: request.revision,
          },
        });
      }
    },
    refreshCompetitions: () =>
      executeWorkflow({
        type: SCOUT_WORKFLOW_NAMES.backgroundJob,
        workflowId: `scout-${stage()}-competition-refresh-remediation-${runId()}`,
        input: { stage: stage(), kind: "competition-refresh" },
      }),
  },
  log: (line) => {
    console.log(`  done: ${line}`);
  },
};

try {
  const plan = await buildRemediationPlan(prisma, scope, {
    hasMatch: async (matchId) =>
      (await deps.riot.fetchMatch(matchId)) !== undefined,
  });
  for (const line of formatRemediationPlan(plan)) console.log(line);
  if (apply) {
    console.log("Applying.");
    await applyRemediationPlan(prisma, plan, deps);
    console.log("Applied. Rerun without --apply to confirm nothing remains.");
  } else {
    console.log(
      "Dry run: nothing changed. Pass --apply to carry out the plan.",
    );
  }
} finally {
  s3.destroy();
  await prisma.$disconnect();
}
