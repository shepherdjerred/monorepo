import path from "node:path";
import { z } from "zod";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { prisma } from "#src/database/index.ts";
import {
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { exploreModel } from "#src/config/dynamic.ts";
import { streamExploreAgent } from "#src/explore/agent.ts";
import { buildDirPath } from "#src/report-lake/paths.ts";
import { readBuildPuuidRemapFingerprint } from "#src/report-lake/build-manifest.ts";
import {
  loadPuuidRemap,
  puuidRemapFingerprint,
} from "#src/report-lake/puuid-remap.ts";
import { withDuckDBConnection } from "#src/reports/duckdb/instance.ts";
import {
  datasetCoherenceIssues,
  datasetRepairHint,
  type StageDatasetPin,
} from "#src/explore/replay/dataset.ts";
import type { ReplayCliOptions } from "#src/explore/replay/cli.ts";
import {
  capabilityMismatches,
  chipExpectation,
  flagOverridesFor,
  guildConfigIssues,
  type CapturedGuildConfig,
} from "#src/explore/replay/profiles.ts";
import {
  exploreChipCases,
  exploreChipCatalogSha256,
} from "#src/explore/replay/chips.ts";
import { resolveReplayCapabilities } from "#src/explore/replay/capabilities.ts";
import {
  runReplayCases,
  type ReplayCaseInput,
  type ReplayObservation,
} from "#src/explore/replay/runner.ts";
import type { ReplaySide } from "#src/explore/replay/diff.ts";
import {
  harnessIntegritySignals,
  replaySignalWeight,
  replaySignals,
} from "#src/explore/replay/signals.ts";
import {
  ReplayCaseIndexEntrySchema,
  ReplayManifestSchema,
  appendBundleLine,
  bundleLocationIssues,
  bundlePaths,
  completedCaseIds,
  createBundleDirectory,
  replayBundleRoot,
  writeBundleFile,
} from "#src/explore/replay/bundle.ts";
import { exploreAgentInstructions } from "#src/explore/prompt.ts";

/**
 * One replay run: verify the dataset, then take each guild through the cases.
 *
 * Loaded dynamically by `replay-explore.ts`, after that script has proved the
 * environment points at the pinned dataset. Importing this module binds the
 * Prisma singleton and the lake reader, so it must never be imported earlier.
 */

const SAMPLED_PUUIDS = 25;

export type ReplayRunOutcome = {
  readonly passed: boolean;
  readonly runDirectories: readonly string[];
};

function sha256Hex(text: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(text);
  return hasher.digest("hex");
}

function accountsParquetPath(pin: StageDatasetPin): string {
  return path.join(
    buildDirPath(pin.lake.dir, pin.lake.buildId),
    "accounts",
    "accounts.parquet",
  );
}

/** Row counts and a membership sample, read straight off the pinned build. */
async function lakeAccountFacts(pin: StageDatasetPin): Promise<{
  readonly rows: number;
  readonly sampledPuuids: readonly string[];
}> {
  const parquet = accountsParquetPath(pin);
  // DuckDB returns unvalidated objects, so both shapes are parsed rather than
  // trusted; a silently-missing column would otherwise read as zero accounts
  // and pass the coherence check it exists to fail.
  const CountRows = z.array(z.object({ total: z.coerce.number() })).min(1);
  const PuuidRows = z.array(z.object({ puuid: z.string().min(1) }));
  return await withDuckDBConnection(async (session) => {
    const counted = CountRows.parse(
      await session.run(`select count(*) as total from read_parquet($1)`, [
        parquet,
      ]),
    );
    const sampled = PuuidRows.parse(
      await session.run(
        `select distinct puuid from read_parquet($1) using sample ${SAMPLED_PUUIDS.toString()} rows`,
        [parquet],
      ),
    );
    return {
      rows: counted[0]?.total ?? 0,
      sampledPuuids: sampled.map((row) => row.puuid),
    };
  });
}

/**
 * Refuse to run on a lake and a database that do not describe the same world.
 *
 * The fingerprint comparison is the same one the compactor performs before
 * folding. A mismatch does not surface as an error at query time — it splits
 * one player into two identities — so it has to be an entry condition.
 */
async function verifyDataset(pin: StageDatasetPin): Promise<void> {
  const buildDir = buildDirPath(pin.lake.dir, pin.lake.buildId);
  const [lakeFingerprint, remap, databaseRows, lakeFacts] = await Promise.all([
    readBuildPuuidRemapFingerprint(buildDir),
    loadPuuidRemap(prisma),
    prisma.account.count(),
    lakeAccountFacts(pin),
  ]);

  const present = await prisma.account.findMany({
    where: { puuid: { in: [...lakeFacts.sampledPuuids] } },
    select: { puuid: true },
  });
  const known = new Set(present.map((row) => row.puuid));

  const issues = datasetCoherenceIssues({
    lakeFingerprint,
    databaseFingerprint: puuidRemapFingerprint(remap),
    accountRows: { parquet: lakeFacts.rows, database: databaseRows },
    sampledPuuids: {
      checked: lakeFacts.sampledPuuids.length,
      missingFromDatabase: lakeFacts.sampledPuuids.filter(
        (puuid) => !known.has(puuid),
      ).length,
    },
  });

  if (issues.length > 0) {
    throw new Error(
      [
        `The ${pin.stage} lake and database do not describe the same world:`,
        ...issues.map((issue) => `  - ${issue}`),
        "",
        datasetRepairHint(pin),
      ].join("\n"),
    );
  }
}

/**
 * Reproduce a captured capability set, and undo it afterwards.
 *
 * Each flag is cleared before the guild's own override is added, so the
 * registry ends up saying exactly what the capture recorded and nothing else.
 * That matters for `betting_enabled` in particular: `resolveBucksCapability`
 * bounds its candidates to guilds carrying a whole-guild override, so a
 * leftover override for a different guild would put two betting guilds in
 * play — which `bucks-tools.ts` throws on.
 */
function applyGuildFlags(config: CapturedGuildConfig): () => void {
  const overrides = flagOverridesFor(config.capabilities);
  const guildId = DiscordGuildIdSchema.parse(config.guildId);
  for (const override of overrides) {
    clearFlagOverrides(override.flag);
    addFlagOverride(override.flag, override.value, { server: guildId });
  }
  return () => {
    for (const override of overrides) {
      resetFlagOverrides(override.flag);
    }
  };
}

function observationSide(observation: ReplayObservation): ReplaySide {
  return {
    answer: observation.answer?.answer ?? null,
    // The model emits the ScoutQL it settled on as part of its structured
    // answer, which is the same field the product persists.
    queryText: observation.answer?.queryText ?? null,
    caveats: observation.answer?.caveats ?? [],
    followUps: observation.answer?.followUps ?? [],
    rowsReturned: observation.preview?.rowsReturned ?? null,
    rowsScanned: observation.preview?.rowsScanned ?? null,
    toolNames: observation.trace.map((entry) => entry.toolName),
    matchCardIds: observation.matchCards.map((card) => card.match.matchId),
    visualizationKind: observation.visualization?.kind ?? null,
  };
}

async function runGuild(input: {
  readonly options: ReplayCliOptions;
  readonly pin: StageDatasetPin;
  readonly config: CapturedGuildConfig;
  readonly runId: string;
}): Promise<{ readonly directory: string; readonly passed: boolean }> {
  const { options, pin, config, runId } = input;
  const surface = "web" as const;
  const configIssues = guildConfigIssues(config, surface);
  if (configIssues.length > 0) {
    throw new Error(
      [
        `Captured config for guild ${config.label} cannot be reproduced:`,
        ...configIssues.map((issue) => `  - ${issue}`),
      ].join("\n"),
    );
  }

  const restoreFlags = applyGuildFlags(config);
  try {
    const runDir = path.join(replayBundleRoot(Bun.env), runId);
    await createBundleDirectory(runDir);
    await createBundleDirectory(path.join(runDir, "cases"));
    const locationIssues = await bundleLocationIssues(runDir);
    if (locationIssues.length > 0) {
      // Before the first model call, so a misplaced run costs nothing.
      throw new Error(
        [`Refusing to write a bundle at ${runDir}:`, ...locationIssues].join(
          "\n  - ",
        ),
      );
    }
    const paths = bundlePaths(runDir);
    const alreadyDone =
      options.resumeRunId === null
        ? new Set<string>()
        : await completedCaseIds(paths.index);

    if (options.includeConversations) {
      throw new Error(
        "Conversation replay is not implemented yet; run with --chips.",
      );
    }

    const requesterId = DiscordAccountIdSchema.parse(config.requesterId);
    const chips = exploreChipCases()
      .filter((chip) =>
        options.onlyCaseId === null ? true : chip.caseId === options.onlyCaseId,
      )
      .filter((chip) => !alreadyDone.has(chip.caseId));
    const selected =
      options.limit === null ? chips : chips.slice(0, options.limit);

    const cases: ReplayCaseInput[] = selected.map((chip) => ({
      caseId: chip.caseId,
      kind: "chip",
      conversationId: globalThis.crypto.randomUUID(),
      question: chip.prompt,
      history: [],
      requesterId,
      guildIds: [config.guildId],
      surface,
      originChannelId: null,
    }));

    const model = exploreModel();
    await writeBundleFile(
      paths.manifest,
      `${JSON.stringify(
        ReplayManifestSchema.parse({
          schemaVersion: 1,
          runId,
          startedAt: new Date().toISOString(),
          stage: pin.stage,
          profile: config.label,
          expectedCapabilities: config.capabilities,
          lake: {
            buildId: pin.lake.buildId,
            puuidRemapFingerprint: pin.lake.puuidRemapFingerprint,
          },
          database: { name: pin.database.name },
          model,
          chipCatalogSha256: exploreChipCatalogSha256(),
          corpusSha256: null,
          corpusVersion: null,
          promptSha256: sha256Hex(
            exploreAgentInstructions({
              bucks: config.capabilities.bucks
                ? { currentTime: "pinned" }
                : null,
              dares: config.capabilities.dares,
              challenges: config.capabilities.challenges,
              creation: config.capabilities.creation,
              riotHistory: config.capabilities.riotHistory,
              surface,
            }),
          ),
          flagOverrides: flagOverridesFor(config.capabilities).map(
            (override) => ({ flag: override.flag, value: override.value }),
          ),
          tokenBudgets: {
            hourly: Number(Bun.env["LLM_HOURLY_TOKEN_BUDGET"] ?? 2_000_000),
            daily: Number(Bun.env["LLM_DAILY_TOKEN_BUDGET"] ?? 20_000_000),
          },
          gitCommit: Bun.env["GIT_SHA"] ?? "unknown",
          concurrency: options.concurrency,
          caseCount: cases.length,
          baselineRunId: options.baselineRunId,
        }),
        null,
        2,
      )}\n`,
    );

    const chipByCaseId = new Map(
      exploreChipCases().map((chip) => [chip.caseId, chip]),
    );
    let integrityFailures = 0;

    await runReplayCases(
      cases,
      {
        executeAgent: streamExploreAgent,
        resolveCapabilities: resolveReplayCapabilities,
        now: () => Date.now(),
        timeoutMs: 120_000,
        newRunId: () => globalThis.crypto.randomUUID(),
      },
      {
        concurrency: options.concurrency,
        onComplete: async (observation) => {
          const chip = chipByCaseId.get(observation.caseId);
          const mismatches = capabilityMismatches({
            config,
            resolved: observation.capabilities,
          });
          const signals = replaySignals({
            status: observation.status,
            answer: observation.answer?.answer ?? null,
            queryFailed: observation.trace.some(
              (entry) =>
                entry.toolName === "run_report_query" &&
                entry.status === "failed",
            ),
            diff: null,
            chipExpectation:
              chip === undefined
                ? null
                : chipExpectation(config.capabilities, chip.condition),
            capabilityMismatches: mismatches,
            baselineRowsReturned: null,
            candidateRowsReturned: observation.preview?.rowsReturned ?? null,
          });
          if (harnessIntegritySignals(signals).length > 0) {
            integrityFailures += 1;
          }
          await writeBundleFile(
            paths.caseFile(observation.caseId),
            `${JSON.stringify(
              {
                meta: {
                  caseId: observation.caseId,
                  kind: "chip",
                  profile: config.label,
                  condition: chip?.condition ?? null,
                  category: chip?.category ?? null,
                  expectation:
                    chip === undefined
                      ? null
                      : chipExpectation(config.capabilities, chip.condition),
                  capabilities: observation.capabilities,
                  capabilityMismatches: mismatches,
                  durationMs: observation.durationMs,
                  lakeBuildId: pin.lake.buildId,
                },
                prompt: observation.modelMessages,
                candidate: observationSide(observation),
                trace: observation.trace,
                signals,
                signalWeight: replaySignalWeight(signals),
                error: observation.error,
              },
              null,
              2,
            )}\n`,
          );
          await appendBundleLine(
            paths.index,
            JSON.stringify(
              ReplayCaseIndexEntrySchema.parse({
                caseId: observation.caseId,
                kind: "chip",
                status: observation.status === "ok" ? "ok" : observation.status,
                durationMs: observation.durationMs,
                signals: [...signals],
              }),
            ),
          );
        },
      },
    );

    const passed = integrityFailures === 0;
    await writeBundleFile(
      paths.summary,
      `${JSON.stringify(
        {
          version: 1,
          runId,
          profile: config.label,
          stage: pin.stage,
          model,
          generatedAt: new Date().toISOString(),
          caseCount: cases.length,
          integrityFailures,
          /** Harness integrity only — never "the answers were good". */
          passed,
        },
        null,
        2,
      )}\n`,
    );
    return { directory: runDir, passed };
  } finally {
    restoreFlags();
  }
}

export async function runReplay(input: {
  readonly options: ReplayCliOptions;
  readonly pin: StageDatasetPin;
  readonly pinPath: string;
}): Promise<ReplayRunOutcome> {
  // Without a registered provider, `isPolicyEnabled` awaits an OpenFeature
  // client that never becomes ready and the first capability resolution hangs
  // forever. "disabled" registers none, so evaluations fall through to the
  // registry defaults the guild overrides are applied to.
  await initFeatureFlags({ environment: { FEATURE_FLAGS_MODE: "disabled" } });
  await verifyDataset(input.pin);

  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const directories: string[] = [];
  let passed = true;

  // No selection means every guild in the pin: the dataset already names the
  // guilds worth evaluating, so an unqualified run evaluates all of them.
  const wanted = new Set(input.options.guilds);
  const configs = Object.values(input.pin.guilds).filter(
    (config) =>
      wanted.size === 0 ||
      wanted.has(config.label) ||
      wanted.has(config.guildId),
  );
  if (configs.length === 0) {
    const known = Object.values(input.pin.guilds)
      .map((config) => `${config.label} (${config.guildId})`)
      .join(", ");
    throw new Error(
      `No guild in the ${input.pin.stage} pin matches ${[...wanted].join(", ")}. Known: ${known}`,
    );
  }

  for (const config of configs) {
    const runId =
      input.options.resumeRunId ??
      `${input.pin.stage}-${config.label}-${stamp}`;
    process.stdout.write(
      `Replaying guild ${config.label} (${config.guildId}) as run ${runId}…\n`,
    );
    const result = await runGuild({
      options: input.options,
      pin: input.pin,
      config,
      runId,
    });
    directories.push(result.directory);
    passed = passed && result.passed;
    process.stdout.write(`  bundle: ${result.directory}\n`);
  }

  // Both hold open handles; without closing them the process sits idle
  // with its work finished, which reads as a hang.
  await prisma.$disconnect();
  await shutdownFeatureFlags();
  return { passed, runDirectories: directories };
}
