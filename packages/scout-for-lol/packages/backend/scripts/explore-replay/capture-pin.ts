import path from "node:path";
import { z } from "zod";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { prisma } from "#src/database/index.ts";
import { databaseSnapshotId } from "./snapshot-identity.ts";
import { writableRowCounts } from "./writable-rows.ts";
import { ME, MY_SERVER } from "#src/configuration/flags.ts";
import { useStageFlagSemantics } from "./stage-flag-semantics.ts";
import { buildDirPath } from "#src/report-lake/paths.ts";
import { readBuildPuuidRemapFingerprint } from "#src/report-lake/build-manifest.ts";
import {
  closeDuckDB,
  withDuckDBConnection,
} from "#src/reports/duckdb/instance.ts";
import { ExploreDurablePayloadSchema } from "#src/explore/runs/durable-payload.ts";
import { resolveReplayCapabilities } from "#src/explore/replay/capabilities.ts";
import {
  CapturedGuildConfigSchema,
  type CapturedGuildConfig,
} from "#src/explore/replay/profiles.ts";
import {
  StageDatasetPinSchema,
  type StageDatasetPin,
} from "#src/explore/replay/dataset.ts";

/**
 * Build a dataset pin by asking the stage what its guilds can do.
 *
 * Loaded dynamically after the environment has been aimed at the snapshot;
 * importing it binds Prisma and the lake reader.
 */

/** The build the pulled lake currently publishes. */
async function publishedBuild(lakeDir: string): Promise<string> {
  const pointer = Bun.file(path.join(lakeDir, "CURRENT"));
  if (!(await pointer.exists())) {
    throw new Error(
      `No CURRENT at ${lakeDir}. Run dev:lake-pull for this stage first.`,
    );
  }
  const text = await pointer.text();
  const buildId = text.trim();
  if (buildId.length === 0) {
    throw new Error(`${lakeDir}/CURRENT is empty.`);
  }
  return buildId;
}

async function parquetAccountRows(
  lakeDir: string,
  buildId: string,
): Promise<number> {
  const parquet = path.join(
    buildDirPath(lakeDir, buildId),
    "accounts",
    "accounts.parquet",
  );
  const Rows = z.array(z.object({ total: z.coerce.number() })).min(1);
  return await withDuckDBConnection(async (session) => {
    const rows = Rows.parse(
      await session.run(`select count(*) as total from read_parquet($1)`, [
        parquet,
      ]),
    );
    return rows[0]?.total ?? 0;
  });
}

/**
 * Where this capture's flag decisions come from.
 *
 * `disabled` registers no provider, so every evaluation falls through to the
 * registry default plus the static overrides — the stage's static
 * configuration, and nothing more. That is the right answer only while the
 * stage has no provider targeting of its own; where Flipt says something
 * different, a static capture records a value the guild does not have and the
 * replay would then reproduce and assert it as if it were real.
 *
 * So the caller decides, and the pin records which it was. Pass
 * `FEATURE_FLAGS_MODE=flipt` with the stage's provider reachable to capture
 * live decisions; leave it unset for the static ones.
 */
type FlagSource = "static" | "provider";

async function startFlags(): Promise<FlagSource> {
  const mode = Bun.env["FEATURE_FLAGS_MODE"];
  if (mode === "flipt") {
    await initFeatureFlags({ environment: Bun.env });
    return "provider";
  }
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
  return "static";
}

/**
 * Every explore run's guild and owner, read from its durable payload.
 *
 * Not from `ScoutInteractiveRun.guildId`: that column is only populated for
 * `report-ai` runs, and is null on every explore row. The guild a turn ran
 * with lives in the payload, which `ExploreDurablePayloadSchema` already
 * parses — so this reuses the product's own reader rather than a second
 * interpretation of the same JSON.
 *
 * Both stages have well under a thousand explore runs, so reading them all and
 * tallying here is cheaper than teaching a query to index into JSON.
 */
async function exploreRunFacts(): Promise<
  readonly { guildId: string; ownerId: string }[]
> {
  const runs = await prisma.scoutInteractiveRun.findMany({
    where: { kind: "explore" },
    select: { ownerId: true, payload: true },
  });
  return runs.flatMap((run) => {
    const parsed = ExploreDurablePayloadSchema.safeParse(
      JSON.parse(run.payload) as unknown,
    );
    if (!parsed.success) return [];
    return parsed.data.guildIds.map((guildId) => ({
      guildId,
      ownerId: run.ownerId,
    }));
  });
}

/**
 * The guilds worth evaluating on this stage.
 *
 * Beta has exactly one: the allowlisted guild, which is `MY_SERVER`. Prod has
 * no allowlist, so the interesting ones are simply those people actually use
 * Explore in — ranked by how many Explore turns they have, excluding my own
 * guild and my own account so "normal guild" means what it says.
 */
async function targetGuilds(
  stage: "beta" | "prod",
  top: number,
): Promise<readonly { guildId: string; label: string }[]> {
  if (stage === "beta") {
    return [{ guildId: MY_SERVER, label: "mine" }];
  }
  const counts = new Map<string, number>();
  for (const fact of await exploreRunFacts()) {
    if (fact.guildId === MY_SERVER || fact.ownerId === ME) continue;
    counts.set(fact.guildId, (counts.get(fact.guildId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .toSorted(([, left], [, right]) => right - left)
    .slice(0, top)
    .map(([guildId], index) => ({
      guildId,
      label: `prod-top-${(index + 1).toString()}`,
    }));
}

/**
 * Whose turn it is for this guild: its most active Explore user.
 *
 * A guild's capabilities do not depend on who asks, but the requester does
 * decide what the bucks and challenge tools can see, so an account with no
 * history would make several chips answer "nothing here" for reasons that have
 * nothing to do with the model.
 */
async function busiestRequester(guildId: string): Promise<string> {
  const counts = new Map<string, number>();
  for (const fact of await exploreRunFacts()) {
    if (fact.guildId !== guildId) continue;
    counts.set(fact.ownerId, (counts.get(fact.ownerId) ?? 0) + 1);
  }
  const busiest = [...counts.entries()].toSorted(
    ([, left], [, right]) => right - left,
  )[0];
  // No Explore history in this guild yet. `ME` is a real account and is the
  // only id guaranteed to exist, so it is the honest fallback — recorded in
  // the pin either way, so a reader can see which it was.
  return busiest?.[0] ?? ME;
}

export async function capturePinForStage(input: {
  readonly stage: "beta" | "prod";
  readonly top: number;
  readonly lakeDir: string;
  readonly databaseName: string;
  readonly databaseUrl: string;
}): Promise<StageDatasetPin> {
  const flagSource = await startFlags();
  useStageFlagSemantics(input.stage);
  const buildId = await publishedBuild(input.lakeDir);
  const fingerprint = await readBuildPuuidRemapFingerprint(
    buildDirPath(input.lakeDir, buildId),
  );
  if (fingerprint === undefined) {
    throw new Error(
      `Build ${buildId} records no PUUID remap fingerprint; its identity domain cannot be proven.`,
    );
  }

  const [parquetRows, databaseRows, guilds] = await Promise.all([
    parquetAccountRows(input.lakeDir, buildId),
    prisma.account.count(),
    targetGuilds(input.stage, input.top),
  ]);

  if (guilds.length === 0) {
    throw new Error(
      `No target guilds found for ${input.stage}. For prod this means no guild has Explore runs from anyone but me.`,
    );
  }

  const captured: Record<string, CapturedGuildConfig> = {};
  for (const guild of guilds) {
    const requesterId = await busiestRequester(guild.guildId);
    const capabilities = await resolveReplayCapabilities({
      guildIds: [guild.guildId],
      surface: "web",
    });
    captured[guild.guildId] = CapturedGuildConfigSchema.parse({
      guildId: guild.guildId,
      label: guild.label,
      requesterId,
      capabilities: {
        ...capabilities,
        // Recorded false because the replay never reproduces it; capturing the
        // real value would make every case fail its own capability check.
        riotHistory: false,
      },
      capturedAt: new Date().toISOString(),
    });
  }

  const now = new Date().toISOString();
  const pin = StageDatasetPinSchema.parse({
    schemaVersion: 1,
    stage: input.stage,
    createdAt: now,
    lake: {
      dir: input.lakeDir,
      buildId,
      puuidRemapFingerprint: fingerprint,
      pulledAt: now,
      sourcePod: "dev:lake-pull",
    },
    database: {
      name: input.databaseName,
      url: input.databaseUrl,
      pulledAt: now,
      snapshotId: await databaseSnapshotId(),
      writableRows: await writableRowCounts(),
    },
    flagSource,
    accountRows: { parquet: parquetRows, database: databaseRows },
    verifiedAt: now,
    guilds: captured,
  });
  // All three hold resources past the work. Prisma and the flag provider keep
  // the process alive outright; DuckDB's native instance is a process-wide
  // singleton the server is meant to keep, and a CLI that leaves it to
  // finalization pays a few seconds of dead time on exit.
  await prisma.$disconnect();
  await shutdownFeatureFlags();
  await closeDuckDB();
  return pin;
}
