import path from "node:path";
import { z } from "zod";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { prisma } from "#src/database/index.ts";
import { ME, MY_SERVER } from "#src/configuration/flags.ts";
import { buildDirPath } from "#src/report-lake/paths.ts";
import { readBuildPuuidRemapFingerprint } from "#src/report-lake/build-manifest.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
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
 * The guilds worth evaluating on this stage.
 *
 * Beta has exactly one: the allowlisted guild, which is `MY_SERVER`. Prod has
 * no allowlist, so the interesting ones are simply those people actually use
 * Explore in — ranked by how many Explore runs they have, excluding my own
 * guild and my own account so "normal guild" means what it says.
 */
async function targetGuilds(
  stage: "beta" | "prod",
  top: number,
): Promise<readonly { guildId: string; label: string }[]> {
  if (stage === "beta") {
    return [{ guildId: MY_SERVER, label: "mine" }];
  }
  const runs = await prisma.scoutInteractiveRun.groupBy({
    by: ["guildId"],
    where: {
      kind: "explore",
      guildId: { not: null },
      ownerId: { not: ME },
    },
    _count: { _all: true },
    orderBy: { _count: { guildId: "desc" } },
    take: top + 1,
  });
  return runs
    .flatMap((row) => (row.guildId === null ? [] : [row.guildId]))
    .filter((guildId) => guildId !== MY_SERVER)
    .slice(0, top)
    .map((guildId, index) => ({
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
  const runs = await prisma.scoutInteractiveRun.groupBy({
    by: ["ownerId"],
    where: { kind: "explore", guildId },
    _count: { _all: true },
    orderBy: { _count: { ownerId: "desc" } },
    take: 1,
  });
  const owner = runs[0]?.ownerId;
  if (owner !== undefined) return owner;
  // No Explore history in this guild yet. `ME` is a real account and is the
  // only id guaranteed to exist, so it is the honest fallback — recorded in
  // the pin either way, so a reader can see which it was.
  return ME;
}

/**
 * Bring the flag client up with no provider.
 *
 * Without this, `isPolicyEnabled` asks an OpenFeature client whose provider
 * was never registered and the call never returns. With mode "disabled" there
 * is no provider to consult, so every evaluation falls through to the value
 * the registry supplies as its default — which is exactly the stage's own
 * static configuration, and what a capture is supposed to read.
 */
async function startFlags(): Promise<void> {
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
}

export async function capturePinForStage(input: {
  readonly stage: "beta" | "prod";
  readonly top: number;
  readonly lakeDir: string;
  readonly databaseName: string;
  readonly databaseUrl: string;
}): Promise<StageDatasetPin> {
  await startFlags();
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
    },
    accountRows: { parquet: parquetRows, database: databaseRows },
    verifiedAt: now,
    guilds: captured,
  });
  // Both hold open handles; without closing them the process sits idle
  // with its work finished, which reads as a hang.
  await prisma.$disconnect();
  await shutdownFeatureFlags();
  return pin;
}
