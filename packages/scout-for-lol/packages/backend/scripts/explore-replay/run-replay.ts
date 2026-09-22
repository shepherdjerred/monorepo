import path from "node:path";
import { readdir } from "node:fs/promises";
import { z } from "zod";
import {
  initFeatureFlags,
  shutdownFeatureFlags,
} from "@shepherdjerred/feature-flags";
import { prisma } from "#src/database/index.ts";
import { databaseSnapshotId } from "./snapshot-identity.ts";
import { writableRowCounts } from "./writable-rows.ts";
import {
  MY_SERVER,
  addFlagOverride,
  clearFlagOverrides,
  resetFlagOverrides,
} from "#src/configuration/flags.ts";
import {
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
} from "@scout-for-lol/data";
import { parseReplayCorpus } from "#src/explore/replay/corpus.ts";
import { useStageFlagSemantics } from "./stage-flag-semantics.ts";
import { planConversationTurns } from "#src/explore/replay/plan.ts";
import { buildTranscript } from "#src/explore/store-mappers.ts";
import { exploreModel } from "#src/config/dynamic.ts";
import { streamExploreAgent } from "#src/explore/agent.ts";
import { buildDirPath } from "#src/report-lake/paths.ts";
import { readBuildPuuidRemapFingerprint } from "#src/report-lake/build-manifest.ts";
import {
  loadPuuidRemap,
  puuidRemapFingerprint,
} from "#src/report-lake/puuid-remap.ts";
import {
  closeDuckDB,
  withDuckDBConnection,
} from "#src/reports/duckdb/instance.ts";
import {
  datasetCoherenceIssues,
  datasetRepairHint,
  type ReplayStage,
  type StageDatasetPin,
} from "#src/explore/replay/dataset.ts";
import type { ReplayCliOptions } from "#src/explore/replay/cli.ts";
import {
  EXPLORE_REPLAY_CAPABILITIES,
  capabilityMismatches,
  chipExpectation,
  flagOverridesFor,
  guildConfigIssues,
  type CapturedGuildConfig,
  type ExploreCapabilitySet,
} from "#src/explore/replay/profiles.ts";
import {
  exploreChipCases,
  exploreChipCatalogSha256,
} from "#src/explore/replay/chips.ts";
import { resolveReplayCapabilities } from "#src/explore/replay/capabilities.ts";
import {
  queryFactsFromTrace,
  runReplayCases,
  type ReplayCaseInput,
  type ReplayObservation,
} from "#src/explore/replay/runner.ts";
import type { ReplayBaseline, ReplaySide } from "#src/explore/replay/diff.ts";
import { scoreCase } from "#src/explore/replay/scoring.ts";
import { validateQuery } from "#src/reports/ai/scoutql-tools.ts";
import {
  harnessIntegritySignals,
  replaySignalWeight,
} from "#src/explore/replay/signals.ts";
import {
  ReplayCaseIndexEntrySchema,
  ReplayCaseCandidateSchema,
  ReplayManifestSchema,
  type ReplayManifest,
  appendBundleLine,
  bundleLocationIssues,
  bundlePaths,
  recordedCaseEntries,
  createBundleDirectory,
  replayBundleRoot,
  runIdIssues,
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

function sha256Hex(data: string | Uint8Array): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(data);
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
  const [
    lakeFingerprint,
    remap,
    databaseRows,
    lakeFacts,
    snapshotId,
    writableRows,
  ] = await Promise.all([
    readBuildPuuidRemapFingerprint(buildDir),
    loadPuuidRemap(prisma),
    prisma.account.count(),
    lakeAccountFacts(pin),
    // What this snapshot contains. Checked so a pin reused against a later
    // pull is refused rather than silently describing data it never saw —
    // while restoring the same dump, which the writable-row check demands
    // between sweeps, reproduces it exactly.
    databaseSnapshotId(),
    writableRowCounts(),
  ]);

  const present = await prisma.account.findMany({
    where: { puuid: { in: [...lakeFacts.sampledPuuids] } },
    select: { puuid: true },
  });
  const known = new Set(present.map((row) => row.puuid));

  const issues = datasetCoherenceIssues({
    snapshotId,
    pinnedSnapshotId: pin.database.snapshotId,
    writableRows,
    pinnedWritableRows: pin.database.writableRows,
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
    // From the trace, not the preview: the preview is present only when the
    // answer rendered a visualization, so reading it there recorded null for
    // most successful queries.
    ...queryFactsFromTrace(observation.trace),
    toolNames: observation.trace.map((entry) => entry.toolName),
    matchCardIds: observation.matchCards.map((card) => card.match.matchId),
    visualizationKind: observation.visualization?.kind ?? null,
  };
}

/**
 * A previous run's candidates, keyed by case id, to measure this one against.
 *
 * Chips never shipped an answer, so their only possible baseline is an earlier
 * run of the same chip — which is what makes the first sweep a baseline rather
 * than just a bundle. A case absent here is reported as new rather than
 * silently uncompared.
 */
/**
 * Every input that decides what a case in this bundle means.
 *
 * Deliberately not the whole manifest: `runId`, `startedAt`, `caseCount` and
 * `concurrency` describe the invocation, and a resume is expected to change
 * them. These are the fields a retained case file was produced under, so a
 * difference in any of them makes the old cases and the new metadata describe
 * different runs.
 */
function manifestDifferences(
  existing: ReplayManifest,
  current: ReplayManifest,
): readonly string[] {
  const differences: string[] = [];
  const compare = (label: string, before: string, now: string): void => {
    if (before !== now) differences.push(`${label}: was ${before}, now ${now}`);
  };
  compare("stage", existing.stage, current.stage);
  compare("guild", existing.guildId, current.guildId);
  compare("lake build", existing.lake.buildId, current.lake.buildId);
  compare(
    "PUUID remap fingerprint",
    existing.lake.puuidRemapFingerprint,
    current.lake.puuidRemapFingerprint,
  );
  compare("database", existing.database.name, current.database.name);
  compare(
    "database snapshot",
    existing.database.snapshotId,
    current.database.snapshotId,
  );
  compare("model", existing.model, current.model);
  compare(
    "chip catalog",
    existing.chipCatalogSha256,
    current.chipCatalogSha256,
  );
  compare(
    "corpus",
    existing.corpusSha256 ?? "none",
    current.corpusSha256 ?? "none",
  );
  compare("prompt", existing.promptSha256, current.promptSha256);
  // The code itself. A tool or runtime change can leave the prompt and catalog
  // hashes untouched while changing every answer.
  compare("revision", existing.gitCommit, current.gitCommit);
  compare(
    "baseline",
    existing.baselineRunId ?? "none",
    current.baselineRunId ?? "none",
  );
  for (const capability of EXPLORE_REPLAY_CAPABILITIES) {
    compare(
      capability,
      String(existing.expectedCapabilities[capability]),
      String(current.expectedCapabilities[capability]),
    );
  }
  return differences;
}

/**
 * The checkout a run was produced from.
 *
 * Not `GIT_SHA`: the documented invocation goes through `dev-web.env.tpl`,
 * which sets it to forty zeroes, and without that file it is unset. Comparing
 * two runs across a code change is the harness's whole purpose, and tool or
 * runtime changes can leave the prompt hash identical, so a bundle that cannot
 * say which revision produced it is missing the one field that would explain
 * the difference. Asked of git directly, and refused rather than guessed.
 *
 * A commit alone is not enough either. "Edit Explore, then compare" is the
 * workflow this harness exists for, and uncommitted edits leave `HEAD` naming
 * the previous commit — attributing results to code that did not produce them.
 * So a dirty tree is recorded as such, fingerprinted by the diff, and two runs
 * from different uncommitted states are visibly different.
 */
async function gitOutput(args: readonly string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed with exit ${exitCode.toString()}.`,
    );
  }
  return out;
}

async function checkoutRevision(): Promise<string> {
  const revision = (await gitOutput(["rev-parse", "HEAD"])).trim();
  if (!/^[0-9a-f]{40}$/.test(revision)) {
    throw new Error(
      "Could not resolve the checkout revision with `git rev-parse HEAD`; a bundle must record which code produced it.",
    );
  }
  // Tracked modifications and untracked files both change what ran.
  // `--untracked-files=all`, because the default collapses an untracked
  // directory to a single `?? dir/` entry — editing a file inside it would
  // leave the fingerprint unchanged.
  const status = (
    await gitOutput(["status", "--porcelain", "--untracked-files=all"])
  ).trim();
  if (status === "") return revision;
  const diff = await gitOutput(["diff", "HEAD"]);
  // `git status` names an untracked file and `git diff HEAD` never carries
  // its bytes, so without this two runs with different contents at the same
  // new path would share a fingerprint — and a resume would retain cases the
  // earlier contents produced.
  const untracked = status
    .split("\n")
    .filter((line) => line.startsWith("?? "))
    .map((line) => line.slice(3).trim())
    .toSorted();
  const untrackedContents: string[] = [];
  for (const file of untracked) {
    const handle = Bun.file(file);
    // A directory, or something removed between the status and this read.
    const bytes = (await handle.exists()) ? await handle.arrayBuffer() : null;
    untrackedContents.push(
      `${file}:${bytes === null ? "unreadable" : sha256Hex(new Uint8Array(bytes))}`,
    );
  }
  const fingerprint = sha256Hex(
    [status, diff, ...untrackedContents].join("\n"),
  );
  return `${revision}-dirty-${fingerprint.slice(0, 12)}`;
}

/** A bundle's manifest, or null when the run directory is new. */
async function readManifestIfPresent(
  manifestPath: string,
): Promise<ReplayManifest | null> {
  const file = Bun.file(manifestPath);
  if (!(await file.exists())) return null;
  return ReplayManifestSchema.parse(await file.json());
}

async function loadBaseline(
  runId: string,
  against: {
    readonly stage: ReplayStage;
    readonly guildId: string;
    readonly capabilities: ExploreCapabilitySet;
    /** This run's corpus, or null when it replays chips only. */
    readonly corpus: { readonly sha256: string } | null;
    /** The data this run reads, so a baseline from other data is refused. */
    readonly lake: { readonly buildId: string; readonly fingerprint: string };
    readonly snapshotId: string;
  },
): Promise<ReadonlyMap<string, ReplayBaseline>> {
  const runDir = path.join(replayBundleRoot(Bun.env), runId);
  const caseDir = path.join(runDir, "cases");

  // A chip id is a hash of its prompt, so the same id exists in every bundle
  // of every profile. Comparing across profiles would report each correct
  // refusal on a guild without the feature as a regression against a guild
  // that has it — a whole column of findings that are only the wrong
  // baseline. The prompt and catalog hashes are deliberately NOT checked:
  // differing there is the reason to run an A/B at all.
  const manifestPath = path.join(runDir, "manifest.json");
  let baselineManifest: unknown;
  try {
    baselineManifest = await Bun.file(manifestPath).json();
  } catch {
    throw new Error(
      `Baseline run ${runId} has no readable manifest at ${manifestPath}; its configuration cannot be proven.`,
    );
  }
  const manifest = ReplayManifestSchema.parse(baselineManifest);
  const conflicts: string[] = [];
  if (manifest.stage !== against.stage) {
    conflicts.push(`stage ${manifest.stage}, not ${against.stage}`);
  }
  // The guild id, not the label. "prod-top-1" is a rank that `capture-pin.ts`
  // reassigns to whoever is busiest in the snapshot being captured, so two
  // pins can give the same label to different guilds — and the chips would be
  // compared across different data scopes without a word about it.
  if (manifest.guildId !== against.guildId) {
    conflicts.push(
      `guild ${manifest.guildId} (labelled ${manifest.profile}), not ${against.guildId}`,
    );
  }
  for (const capability of EXPLORE_REPLAY_CAPABILITIES) {
    const before = manifest.expectedCapabilities[capability];
    const now = against.capabilities[capability];
    if (before !== now) {
      conflicts.push(`${capability} was ${String(before)}, now ${String(now)}`);
    }
  }
  // A conversation case id is the conversation and turn index, which survives
  // re-curation: repin a leaf and the same id carries a different question.
  // Only the corpus hash can tell those apart.
  // The data both runs read. A baseline from an older lake build or a
  // re-pulled snapshot would differ on numbers and queries because the world
  // changed, and the bundle would present that as candidate-versus-baseline.
  if (manifest.lake.buildId !== against.lake.buildId) {
    conflicts.push(
      `lake build ${manifest.lake.buildId}, not ${against.lake.buildId}`,
    );
  }
  if (manifest.lake.puuidRemapFingerprint !== against.lake.fingerprint) {
    conflicts.push(
      `PUUID remap ${manifest.lake.puuidRemapFingerprint}, not ${against.lake.fingerprint}`,
    );
  }
  if (manifest.database.snapshotId !== against.snapshotId) {
    conflicts.push(
      `database snapshot ${manifest.database.snapshotId}, not ${against.snapshotId}`,
    );
  }

  const baselineCorpus = manifest.corpusSha256;
  const thisCorpus = against.corpus?.sha256 ?? null;
  if (baselineCorpus !== thisCorpus) {
    conflicts.push(
      `corpus ${baselineCorpus ?? "none"}, not ${thisCorpus ?? "none"}; a re-curated corpus can attach the same case id to a different question`,
    );
  }

  if (conflicts.length > 0) {
    throw new Error(
      [
        `Baseline run ${runId} is not comparable to this run:`,
        ...conflicts.map((conflict) => `  - ${conflict}`),
        "",
        "Pass a baseline from the same stage, guild and capability set.",
      ].join("\n"),
    );
  }
  const BaselineCaseSchema = z
    .object({
      meta: z
        .object({
          caseId: z.string(),
          // Absent in bundles written before the field existed.
          status: z.enum(["ok", "error", "timeout"]).optional(),
        })
        .loose(),
      candidate: ReplayCaseCandidateSchema,
    })
    .loose();

  const entries = new Map<string, ReplayBaseline>();
  let files: string[];
  try {
    files = (await readdir(caseDir)).filter((name) => name.endsWith(".json"));
  } catch {
    throw new Error(
      `No bundle at ${runDir} to use as a baseline. Pass a run id that exists under ${replayBundleRoot(Bun.env)}.`,
    );
  }
  for (const file of files) {
    const raw: unknown = await Bun.file(path.join(caseDir, file)).json();
    const parsed = BaselineCaseSchema.parse(raw);
    // A turn that errored or timed out produced no answer. Diffing a later
    // success against that empty observation would report every figure as
    // newly added; the case is better off reported as having no baseline.
    if (parsed.meta.status !== undefined && parsed.meta.status !== "ok") {
      continue;
    }
    if (parsed.candidate.answer === null) continue;
    entries.set(parsed.meta.caseId, {
      ...parsed.candidate,
      source: "run",
      // A run baseline has no stored timestamp of its own; the manifest dates
      // the whole run, and per-case age would be misleading precision.
      createdAt: null,
    });
  }
  return entries;
}

/**
 * Turn the committed corpus for a stage into cases.
 *
 * Each turn is its own case, answered as the person who asked it and with the
 * guild that turn actually ran with — not the guild config's persona. A
 * conversation turn is a record of something that happened; borrowing another
 * identity or another guild would make the comparison meaningless.
 */
async function conversationCasesFor(
  stage: "beta" | "prod",
  surface: "web",
): Promise<{
  readonly cases: ReplayCaseInput[];
  /**
   * Which corpus revision produced these cases.
   *
   * Two bundles built from different corpus revisions are not comparable, and
   * without this the manifest could not tell them apart.
   */
  readonly corpus: { readonly sha256: string; readonly version: number };
  /**
   * The answer each turn originally produced.
   *
   * A conversation turn is the one case kind with a real baseline: somebody
   * asked this and got that. Comparing against it is the entire reason to
   * replay a conversation rather than a chip.
   */
  readonly baselines: Map<string, ReplayBaseline>;
}> {
  const corpusPath = new URL(
    `../../src/explore/replay/corpus.${stage}.json`,
    import.meta.url,
  );
  const file = Bun.file(corpusPath);
  if (!(await file.exists())) {
    throw new Error(
      `No conversation corpus for ${stage}. Create one with explore:curate-corpus --stage ${stage} --write.`,
    );
  }
  const corpusText = await file.text();
  const corpus = parseReplayCorpus(JSON.parse(corpusText) as unknown);
  if (corpus.stage !== stage) {
    throw new Error(
      `Corpus at ${corpusPath.pathname} is for ${corpus.stage}, not ${stage}.`,
    );
  }

  const soleAllowedGuildId = stage === "beta" ? MY_SERVER : null;
  const cases: ReplayCaseInput[] = [];
  const baselines = new Map<string, ReplayBaseline>();

  for (const entry of corpus.conversations) {
    const conversation = await prisma.exploreConversation.findFirst({
      where: { id: entry.conversationId },
      include: { messages: true },
    });
    if (conversation === null) {
      throw new Error(
        `Corpus names conversation ${entry.conversationId}, which is not in this ${stage} snapshot. Re-pull the dataset or re-curate.`,
      );
    }
    const runs = await prisma.scoutInteractiveRun.findMany({
      where: { kind: "explore", conversationId: entry.conversationId },
      select: { resultMessageId: true, payload: true },
    });

    const planned = planConversationTurns({
      entry,
      transcript: buildTranscript(
        conversation,
        conversation.messages,
        entry.leafId,
      ),
      runs,
      soleAllowedGuildId,
    });

    for (const turn of planned) {
      baselines.set(turn.caseId, {
        source: "stored",
        createdAt: turn.baseline.createdAt,
        answer: turn.baseline.content,
        queryText: turn.baseline.queryText,
        caveats: turn.baseline.caveats,
        followUps: turn.baseline.followUps,
        rowsReturned: turn.baseline.preview?.rowsReturned ?? null,
        rowsScanned: turn.baseline.preview?.rowsScanned ?? null,
        toolNames: turn.baseline.trace.map((entry) => entry.toolName),
        matchCardIds: turn.baseline.matchCards.map(
          (card) => card.match.matchId,
        ),
        visualizationKind: turn.baseline.visualization?.kind ?? null,
      });
      cases.push({
        caseId: turn.caseId,
        kind: "conversation",
        conversationId: turn.conversationId,
        question: turn.question,
        history: turn.history,
        requesterId: DiscordAccountIdSchema.parse(conversation.userId),
        guildIds: turn.guildIds,
        surface,
        originChannelId: null,
      });
    }
  }
  return {
    cases,
    baselines,
    corpus: { sha256: sha256Hex(corpusText), version: corpus.version },
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

  // Before the id becomes a path. The directory is created and chmodded
  // before any manifest is read, so a traversing id would mutate somewhere
  // else entirely.
  const idIssues = runIdIssues(runId);
  if (idIssues.length > 0) {
    throw new Error(
      `Run id ${JSON.stringify(runId)} cannot name a bundle directory: ${idIssues.join(", ")}.`,
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

    const priorEntries =
      options.resumeRunId === null
        ? []
        : await recordedCaseEntries(paths.index);
    // An index entry is a claim that a case ran; the case file is the evidence.
    // Skipping on the claim alone would let a bundle whose case file was
    // deleted or truncated report a full case count and `passed: true` with
    // nothing behind that case. Checked before the skip, so the run either has
    // the evidence or says which case lost it.
    const missingEvidence: string[] = [];
    for (const entry of priorEntries) {
      const caseFile = Bun.file(paths.caseFile(entry.caseId));
      if (!(await caseFile.exists())) {
        missingEvidence.push(`${entry.caseId}: no case file`);
        continue;
      }
      try {
        // The whole record, and its identity — not just a well-formed
        // candidate. Two case files swapped leaves both candidates valid, and
        // resume would skip both cases while their evidence describes the
        // other's prompt.
        const record = z
          .looseObject({
            meta: z.looseObject({
              caseId: z.string(),
              status: z.enum(["ok", "error", "timeout"]).optional(),
            }),
            candidate: ReplayCaseCandidateSchema,
          })
          .parse(await caseFile.json());
        if (record.meta.caseId !== entry.caseId) {
          missingEvidence.push(
            `${entry.caseId}: its case file records ${record.meta.caseId}`,
          );
        } else if (
          record.meta.status !== undefined &&
          record.meta.status !== entry.status
        ) {
          missingEvidence.push(
            `${entry.caseId}: indexed as ${entry.status}, recorded as ${record.meta.status}`,
          );
        }
      } catch {
        missingEvidence.push(`${entry.caseId}: case file is unreadable`);
      }
    }
    if (missingEvidence.length > 0) {
      throw new Error(
        [
          `Run ${runId} is indexed as having cases whose evidence is gone:`,
          ...missingEvidence.map((entry) => `  - ${entry}`),
          "",
          "Resuming would report them as complete; start a new run instead.",
        ].join("\n"),
      );
    }

    const alreadyDone = new Set(priorEntries.map((entry) => entry.caseId));

    // The skipped half of a resumed run still happened. Counting only the
    // cases this invocation executed would let a clean remainder rewrite
    // `summary.json` with `passed: true` over an earlier errored case, which
    // is the one thing `passed` is supposed to rule out.
    const priorIntegrityFailures = priorEntries.filter(
      (entry) => harnessIntegritySignals(entry.signals).length > 0,
    ).length;

    const requesterId = DiscordAccountIdSchema.parse(config.requesterId);

    const chipCases: ReplayCaseInput[] = options.includeChips
      ? exploreChipCases().map((chip) => ({
          caseId: chip.caseId,
          kind: "chip",
          conversationId: globalThis.crypto.randomUUID(),
          question: chip.prompt,
          history: [],
          requesterId,
          guildIds: [config.guildId],
          surface,
          originChannelId: null,
        }))
      : [];

    // A conversation turn answers as the person who asked it, not as the
    // guild's busiest user: the bucks and challenge tools read the requester,
    // so borrowing someone else's identity would change what the turn can see.
    const conversations = options.includeConversations
      ? await conversationCasesFor(pin.stage, surface)
      : {
          cases: [] as ReplayCaseInput[],
          baselines: new Map<string, ReplayBaseline>(),
          // Null is reserved for a run that read no corpus, which is what a
          // chip-only sweep is.
          corpus: null,
        };
    // A turn belongs to the guild it actually ran with. `runGuild` installs
    // one guild's flag overrides and judges every mismatch against that
    // guild's captured profile, so replaying another guild's turns here would
    // answer them under capabilities they never had — and a prod pin with two
    // profiles would replay the whole corpus twice, once wrongly.
    //
    // An exact singleton, not `includes`. A turn that ran with several guilds
    // in scope could query all of them while only this profile's overrides
    // were installed, and the mismatch check — which asks about this profile —
    // would not necessarily notice. A pin describes one guild at a time, so a
    // multi-guild turn has no profile here and is left out rather than
    // answered under a narrower configuration than it had.
    const skippedMultiGuild: string[] = [];
    const conversationCases = conversations.cases.filter((entry) => {
      if (entry.guildIds.length === 1 && entry.guildIds[0] === config.guildId) {
        return true;
      }
      if (entry.guildIds.includes(config.guildId)) {
        skippedMultiGuild.push(entry.caseId);
      }
      return false;
    });
    if (skippedMultiGuild.length > 0) {
      process.stdout.write(
        `  skipped ${skippedMultiGuild.length.toString()} turn(s) that ran with more guilds than ${config.label} covers\n`,
      );
    }

    const selectable = [...chipCases, ...conversationCases];
    // Every case's kind, so a bundle's records say what they actually are
    // rather than assuming the chip sweep.
    const caseKinds = new Map(
      selectable.map((entry) => [entry.caseId, entry.kind] as const),
    );

    // Checked against the unfiltered set, before resume exclusions: a typo in
    // --only would otherwise select nothing, and a zero-case run writes
    // `passed: true` and exits clean, which is the decorative-eval failure
    // this harness is built to avoid. An already-completed case is a different
    // thing and stays a valid no-op.
    if (options.onlyCaseId !== null && !caseKinds.has(options.onlyCaseId)) {
      throw new Error(
        `--only names ${options.onlyCaseId}, which is not in the ${pin.stage} corpus for ${config.label}. Check the case id, or add --conversations if it is a conversation turn.`,
      );
    }

    const all = selectable
      .filter((entry) =>
        options.onlyCaseId === null
          ? true
          : entry.caseId === options.onlyCaseId,
      )
      .filter((entry) => !alreadyDone.has(entry.caseId));
    const cases = options.limit === null ? all : all.slice(0, options.limit);

    const model = exploreModel();
    const manifest = ReplayManifestSchema.parse({
      schemaVersion: 1,
      runId,
      startedAt: new Date().toISOString(),
      stage: pin.stage,
      profile: config.label,
      guildId: config.guildId,
      expectedCapabilities: config.capabilities,
      lake: {
        buildId: pin.lake.buildId,
        puuidRemapFingerprint: pin.lake.puuidRemapFingerprint,
      },
      database: {
        name: pin.database.name,
        snapshotId: pin.database.snapshotId,
      },
      model,
      chipCatalogSha256: exploreChipCatalogSha256(),
      corpusSha256: conversations.corpus?.sha256 ?? null,
      corpusVersion: conversations.corpus?.version ?? null,
      promptSha256: sha256Hex(
        exploreAgentInstructions({
          bucks: config.capabilities.bucks ? { currentTime: "pinned" } : null,
          dares: config.capabilities.dares,
          challenges: config.capabilities.challenges,
          creation: config.capabilities.creation,
          riotHistory: config.capabilities.riotHistory,
          // A non-null value adds the MVP instructions and skill entry to
          // the prompt, so omitting it would hash the disabled prompt and
          // record provenance the run did not have.
          mvpVotes: config.capabilities.mvpVotes
            ? { currentTime: "pinned" }
            : null,
          clash: config.capabilities.clash,
          surface,
        }),
      ),
      flagOverrides: flagOverridesFor(config.capabilities).map((override) => ({
        flag: override.flag,
        value: override.value,
      })),
      tokenBudgets: {
        hourly: Number(Bun.env["LLM_HOURLY_TOKEN_BUDGET"] ?? 2_000_000),
        daily: Number(Bun.env["LLM_DAILY_TOKEN_BUDGET"] ?? 20_000_000),
      },
      gitCommit: await checkoutRevision(),
      concurrency: options.concurrency,
      caseCount: priorEntries.length + cases.length,
      baselineRunId: options.baselineRunId,
    });

    // Before a single byte is written. A resume keeps the case files already
    // in the bundle and overwrites the manifest, so every input that decides
    // what a case *means* has to match — not just the guild. Resuming after
    // the pin, corpus, capabilities, prompt or baseline changed would leave a
    // bundle whose metadata describes inputs its retained cases never saw.
    if (options.resumeRunId !== null) {
      const existing = await readManifestIfPresent(paths.manifest);
      if (existing === null) {
        // A resume must prove what it is resuming. With no manifest there is
        // nothing to compare against, and any index or case files left in the
        // directory would be retained under provenance nobody established —
        // while a mistyped run id would quietly begin fresh model spend under
        // a name that means nothing.
        throw new Error(
          [
            `--resume names ${runId}, which has no manifest at ${paths.manifest}.`,
            "A resume continues a bundle that can say what produced it; start a new run instead.",
          ].join("\n"),
        );
      }
      const differences = manifestDifferences(existing, manifest);
      if (differences.length > 0) {
        throw new Error(
          [
            `Run ${runId} was produced with different inputs:`,
            ...differences.map((difference) => `  - ${difference}`),
            "",
            "Resume it with the inputs it ran under, or start a new run.",
          ].join("\n"),
        );
      }
    }

    await writeBundleFile(
      paths.manifest,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );

    const chipByCaseId = new Map(
      exploreChipCases().map((chip) => [chip.caseId, chip]),
    );
    // A conversation turn brings its own stored baseline; a chip can only
    // have one from an earlier run. A `--baseline` run wins where both exist,
    // since that is what the operator explicitly asked to compare against.
    const baseline = new Map<string, ReplayBaseline>(conversations.baselines);
    if (options.baselineRunId !== null) {
      const baselineEntries = await loadBaseline(options.baselineRunId, {
        stage: pin.stage,
        guildId: config.guildId,
        capabilities: config.capabilities,
        corpus: conversations.corpus,
        lake: {
          buildId: pin.lake.buildId,
          fingerprint: pin.lake.puuidRemapFingerprint,
        },
        snapshotId: pin.database.snapshotId,
      });
      for (const [caseId, entry] of baselineEntries) {
        baseline.set(caseId, entry);
      }
    }
    let integrityFailures = priorIntegrityFailures;

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
          const candidate = observationSide(observation);
          const { signals, diff } = scoreCase({
            status: observation.status,
            answer: observation.answer?.answer ?? null,
            trace: observation.trace,
            rowsReturned: observation.preview?.rowsReturned ?? null,
            capabilities: config.capabilities,
            condition: chip?.condition ?? null,
            capabilityMismatches: mismatches,
            candidate,
            comparison: ((): Parameters<typeof scoreCase>[0]["comparison"] => {
              const entry = baseline.get(observation.caseId);
              return entry === undefined
                ? { kind: "none" }
                : { kind: "baseline", baseline: entry };
            })(),
            // The formatter can reword a query on its own, so both sides are
            // canonicalised before comparison and a formatting change is not
            // reported as the agent writing something different.
            normalizeQuery: (text) =>
              validateQuery(text).formattedQueryText ?? null,
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
                  kind: caseKinds.get(observation.caseId) ?? "chip",
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
                  // Stored so a re-score is exact: an error and a timeout read
                  // very differently and cannot be told apart from the message.
                  status: observation.status,
                  baselineRunId: options.baselineRunId,
                },
                prompt: observation.modelMessages,
                candidate,
                diff,
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
                kind: caseKinds.get(observation.caseId) ?? "chip",
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
          // The whole bundle, not this invocation. A resume executes only what
          // the index lacks, so `cases.length` would report a completed
          // 232-case bundle as zero.
          caseCount: priorEntries.length + cases.length,
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
  // Before any flag is evaluated: a prod pin must resolve flags the way prod
  // does, and the caller cannot supply that without also supplying stage
  // config the replay never uses.
  useStageFlagSemantics(input.pin.stage);

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

  // A bundle belongs to one guild: its manifest records that guild's profile
  // and expected capabilities. With more than one selected, every guild would
  // reuse the resumed run's directory in turn — the second inheriting the
  // first's completed ids and overwriting its manifest and summary with its
  // own metadata, leaving a bundle that describes one guild and contains
  // another's answers.
  if (input.options.resumeRunId !== null && configs.length > 1) {
    throw new Error(
      [
        `--resume names one bundle, but ${configs.length.toString()} guilds are selected: ${configs
          .map((config) => config.label)
          .join(", ")}.`,
        "Pass --guild <label> to name the one this bundle belongs to.",
      ].join("\n"),
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

  // All three hold resources past the work. Prisma and the flag provider keep
  // the process alive outright; DuckDB's native instance is a process-wide
  // singleton the server is meant to keep, and a CLI that leaves it to
  // finalization pays a few seconds of dead time on exit.
  await prisma.$disconnect();
  await shutdownFeatureFlags();
  await closeDuckDB();
  return { passed, runDirectories: directories };
}
