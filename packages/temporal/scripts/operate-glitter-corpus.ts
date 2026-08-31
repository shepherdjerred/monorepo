import { Client, Connection } from "@temporalio/client";
import { z } from "zod/v4";
import {
  ChannelStateResultSchema,
  InventoryResultSchema,
} from "#shared/glitter-corpus-activity-types.ts";
import { GlitterContextAuditResultSchema } from "#activities/glitter-context-audit-schema.ts";
import { GlitterCorpusSnapshotPinSchema } from "#activities/glitter-context-refresh-corpus.ts";
import { temporalConnectionOptions } from "#lib/temporal-connection.ts";
import { GuildSnapshotSchema } from "#shared/glitter-corpus.ts";
import { TASK_QUEUES } from "#shared/task-queues.ts";
import { parseTemporalNamespace } from "#shared/temporal-namespace.ts";

const DEFAULT_TEMPORAL_ADDRESS =
  "temporal-server.temporal.svc.cluster.local:7233";

function usage(): never {
  console.error(
    [
      "Usage:",
      "  TEMPORAL_NAMESPACE=prod bun run glitter:operate inventory",
      "  TEMPORAL_NAMESPACE=prod bun run glitter:operate canary --guild-id=<id> --guild-slug=<slug> --channel-id=<id> [--seed-prefix=<prefix>] [--max-pages=<n>]",
      "  TEMPORAL_NAMESPACE=prod bun run glitter:operate backfill --inventory-key=<key> --inventory-sha=<sha256> [--seed-prefix=<prefix>] [--max-pages=<n>] [--wait=true]",
      "  TEMPORAL_NAMESPACE=prod bun run glitter:operate daily [--wait=true]",
      "  TEMPORAL_NAMESPACE=prod bun run glitter:operate context-refresh --dry-run=<true|false> --max-estimated-cost-usd=<usd> [--now=<iso>] [--snapshot-id=<uuid> --snapshot-sha256=<sha256>] [--wait=true]",
      "  TEMPORAL_NAMESPACE=prod bun run glitter:operate context-audit [--now=<iso>] [--snapshot-id=<uuid> --snapshot-sha256=<sha256>] [--wait=true]",
    ].join("\n"),
  );
  process.exit(2);
}

function flags(argv: readonly string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (const argument of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(argument);
    if (match?.[1] === undefined || match[2] === undefined) {
      usage();
    }
    parsed[match[1]] = match[2];
  }
  return parsed;
}

/**
 * Flags shared by both Glitter context commands: an optional evaluation clock
 * and an optional corpus-snapshot pin, plus whether to await the result. Kept
 * as one fragment so the two command schemas cannot drift apart.
 */
const CONTEXT_COMMAND_FLAGS = {
  now: z.iso.datetime({ offset: true }).optional(),
  "snapshot-id": z.uuid().optional(),
  "snapshot-sha256": z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  wait: z.enum(["true", "false"]).default("false"),
} as const;

type ContextCommandFlags = {
  now?: string | undefined;
  "snapshot-id"?: string | undefined;
  "snapshot-sha256"?: string | undefined;
};

/**
 * Starts one of the two Glitter context workflows. They differ only in
 * workflow type, workflow-id prefix, and any command-specific arguments; the
 * clock and snapshot pin are carried identically by both.
 */
async function startContextWorkflow(input: {
  client: Client;
  workflowType: string;
  workflowIdPrefix: string;
  parsed: ContextCommandFlags;
  extraArgs?: Record<string, unknown>;
}) {
  const { parsed } = input;
  const snapshot =
    parsed["snapshot-id"] === undefined &&
    parsed["snapshot-sha256"] === undefined
      ? undefined
      : GlitterCorpusSnapshotPinSchema.parse({
          snapshotId: parsed["snapshot-id"],
          snapshotSha256: parsed["snapshot-sha256"],
        });
  return await startWorkflow({
    client: input.client,
    workflowType: input.workflowType,
    workflowId: `${input.workflowIdPrefix}-${crypto.randomUUID()}`,
    args: [
      {
        ...input.extraArgs,
        ...(parsed.now === undefined ? {} : { now: parsed.now }),
        ...(snapshot === undefined ? {} : { snapshot }),
      },
    ],
  });
}

async function startWorkflow(input: {
  client: Client;
  workflowType: string;
  workflowId: string;
  args: unknown[];
}) {
  const handle = await input.client.workflow.start(input.workflowType, {
    args: input.args,
    taskQueue: TASK_QUEUES.WORKFLOWS,
    workflowId: input.workflowId,
  });
  console.warn(
    JSON.stringify({
      workflowId: handle.workflowId,
      runId: handle.firstExecutionRunId,
    }),
  );
  return handle;
}

async function printSnapshotResult(
  handle: Awaited<ReturnType<typeof startWorkflow>>,
): Promise<void> {
  const result = z
    .looseObject({ snapshot: GuildSnapshotSchema })
    .parse(await handle.result());
  console.warn(JSON.stringify(result, null, 2));
}

async function runInventory(
  client: Client,
  argv: readonly string[],
): Promise<void> {
  if (argv.length > 0) {
    usage();
  }
  const handle = await startWorkflow({
    client,
    workflowType: "runGlitterCorpusInventory",
    workflowId: `glitter-corpus-inventory-${crypto.randomUUID()}`,
    args: [],
  });
  const result = InventoryResultSchema.parse(await handle.result());
  console.warn(
    JSON.stringify(
      {
        inventoryKey: result.inventoryKey,
        inventorySha256: result.inventory.sha256,
        guildId: result.inventory.guildId,
        guildName: result.inventory.guildName,
        included: result.inventory.entries.filter(
          (entry) => entry.scopeDecision === "include",
        ),
        excluded: result.inventory.entries.filter(
          (entry) => entry.scopeDecision !== "include",
        ),
      },
      null,
      2,
    ),
  );
}

async function runCanary(
  client: Client,
  argv: readonly string[],
): Promise<void> {
  const parsed = z
    .object({
      "guild-id": z.string().regex(/^\d+$/),
      "guild-slug": z.string().min(1),
      "channel-id": z.string().regex(/^\d+$/),
      "seed-prefix": z.string().min(1).optional(),
      "max-pages": z.coerce.number().int().positive().default(100),
    })
    .strict()
    .parse(flags(argv));
  const snapshotId = crypto.randomUUID();
  const handle = await startWorkflow({
    client,
    workflowType: "runGlitterCorpusChannelBackfill",
    workflowId: `glitter-corpus-canary-${parsed["channel-id"]}-${snapshotId}`,
    args: [
      {
        snapshotId,
        guildId: parsed["guild-id"],
        guildSlug: parsed["guild-slug"],
        channelId: parsed["channel-id"],
        verifiedAt: new Date().toISOString(),
        ...(parsed["seed-prefix"] === undefined
          ? {}
          : { seedPrefix: parsed["seed-prefix"] }),
        maxPages: parsed["max-pages"],
      },
    ],
  });
  console.warn(
    JSON.stringify(
      ChannelStateResultSchema.parse(await handle.result()),
      null,
      2,
    ),
  );
}

async function runBackfill(
  client: Client,
  argv: readonly string[],
): Promise<void> {
  const parsed = z
    .object({
      "inventory-key": z.string().min(1),
      "inventory-sha": z.string().regex(/^[0-9a-f]{64}$/),
      "seed-prefix": z.string().min(1).optional(),
      "max-pages": z.coerce.number().int().positive().optional(),
      wait: z.enum(["true", "false"]).default("false"),
    })
    .strict()
    .parse(flags(argv));
  const handle = await startWorkflow({
    client,
    workflowType: "runGlitterCorpusBackfill",
    workflowId: `glitter-corpus-backfill-${crypto.randomUUID()}`,
    args: [
      {
        inventoryKey: parsed["inventory-key"],
        inventorySha256: parsed["inventory-sha"],
        ...(parsed["seed-prefix"] === undefined
          ? {}
          : { seedPrefix: parsed["seed-prefix"] }),
        ...(parsed["max-pages"] === undefined
          ? {}
          : { maxPagesPerChannel: parsed["max-pages"] }),
      },
    ],
  });
  if (parsed.wait === "true") {
    await printSnapshotResult(handle);
  }
}

async function runDaily(
  client: Client,
  argv: readonly string[],
): Promise<void> {
  const parsed = z
    .object({ wait: z.enum(["true", "false"]).default("false") })
    .strict()
    .parse(flags(argv));
  const handle = await startWorkflow({
    client,
    workflowType: "runGlitterCorpusDaily",
    workflowId: `glitter-corpus-daily-manual-${crypto.randomUUID()}`,
    args: [],
  });
  if (parsed.wait === "true") {
    await printSnapshotResult(handle);
  }
}

async function runContextRefresh(
  client: Client,
  argv: readonly string[],
): Promise<void> {
  const parsed = z
    .object({
      "dry-run": z.enum(["true", "false"]),
      "max-estimated-cost-usd": z.coerce.number().positive(),
      ...CONTEXT_COMMAND_FLAGS,
    })
    .strict()
    .parse(flags(argv));
  const handle = await startContextWorkflow({
    client,
    workflowType: "runGlitterContextRefresh",
    workflowIdPrefix: "glitter-context-refresh-manual",
    parsed,
    extraArgs: {
      dryRun: parsed["dry-run"] === "true",
      maxEstimatedCostUsd: parsed["max-estimated-cost-usd"],
    },
  });
  if (parsed.wait === "true") {
    const result = z
      .object({
        outcome: z.enum(["pr-created", "no-diff", "dry-run"]),
        snapshotId: z.uuid(),
        snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
        proposalSha256: z.string().regex(/^[0-9a-f]{64}$/),
        eligiblePeople: z.array(z.string()),
        refreshedPeople: z.array(z.string()),
        // People this run could not refresh, with the reason. The schema is
        // strict, so this has to track the activity's result type or a waiting
        // operator's `.parse()` throws after a billable run has already
        // succeeded — hiding the result and inviting a needless rerun.
        skippedPeople: z.array(
          z.object({ personId: z.string(), reason: z.string() }).strict(),
        ),
        relationshipProposalCount: z.number().int().nonnegative(),
        generation: z
          .object({
            maxUncachedCostUsd: z.number().nonnegative(),
            preflightEstimatedCostUsd: z.number().nonnegative(),
            actualUncachedCostUsd: z.number().nonnegative(),
            cacheHits: z.number().int().nonnegative(),
            cacheMisses: z.number().int().nonnegative(),
            inputTokens: z.number().int().nonnegative(),
            outputTokens: z.number().int().nonnegative(),
            cachedInputTokens: z.number().int().nonnegative(),
            artifactKeys: z.array(z.string()),
          })
          .strict(),
        changedFiles: z.array(z.string()),
        branchName: z.string().optional(),
        commitHash: z.string().optional(),
        prUrl: z.url().optional(),
      })
      .strict()
      .parse(await handle.result());
    console.warn(JSON.stringify(result, null, 2));
  }
}

async function runContextAudit(
  client: Client,
  argv: readonly string[],
): Promise<void> {
  const parsed = z.object(CONTEXT_COMMAND_FLAGS).strict().parse(flags(argv));
  const handle = await startContextWorkflow({
    client,
    workflowType: "runGlitterContextAudit",
    workflowIdPrefix: "glitter-context-audit",
    parsed,
  });
  if (parsed.wait === "true") {
    console.warn(
      JSON.stringify(
        GlitterContextAuditResultSchema.parse(await handle.result()),
        null,
        2,
      ),
    );
  }
}

async function main(): Promise<void> {
  const [command, ...argv] = process.argv.slice(2);
  if (command === undefined) {
    usage();
  }
  const connection = await Connection.connect(
    temporalConnectionOptions({
      environment: Bun.env,
      defaultAddress: DEFAULT_TEMPORAL_ADDRESS,
    }),
  );
  const namespace = parseTemporalNamespace(Bun.env["TEMPORAL_NAMESPACE"]);
  const client = new Client({ connection, namespace });
  switch (command) {
    case "inventory": {
      await runInventory(client, argv);

      break;
    }
    case "canary": {
      await runCanary(client, argv);

      break;
    }
    case "backfill": {
      await runBackfill(client, argv);

      break;
    }
    case "daily": {
      await runDaily(client, argv);

      break;
    }
    case "context-refresh": {
      await runContextRefresh(client, argv);

      break;
    }
    case "context-audit": {
      await runContextAudit(client, argv);

      break;
    }
    default: {
      usage();
    }
  }
}

await main();
