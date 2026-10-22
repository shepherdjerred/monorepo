import type { ExploreQuestionImage } from "#src/explore/analysis/agent-types.ts";
import path from "node:path";
import { chmod, mkdir } from "node:fs/promises";
import {
  createLlmRuntime,
  providerCredentialsFromEnv,
  requireCredentialsFor,
} from "@shepherdjerred/llm-runtime";
import type {
  ExploreMessage,
  ExploreScenarioCorpus,
} from "@scout-for-lol/data";
import configuration from "#src/configuration.ts";
import { prisma } from "#src/database/index.ts";
import {
  initializeDynamicConfig,
  shutdownDynamicConfig,
} from "#src/config/dynamic.ts";
import { addFlagOverride } from "#src/configuration/flags.ts";
import { streamExploreAgent } from "#src/explore/agent.ts";
import { closeDuckDB } from "#src/reports/duckdb/instance.ts";
import { writeAccountsParquet } from "#src/report-lake/compact-accounts.ts";
import {
  createBotRestReader,
  installBotRestReader,
} from "#src/lib/discord/bot-rest.ts";
import { ReplayRuntimeProvider } from "#src/explore/replay/runtime-provider.ts";
import { resolveReplayCapabilities } from "#src/explore/replay/capabilities.ts";
import { flagOverridesFor } from "#src/explore/replay/profiles.ts";
import { runReplayCase } from "#src/explore/replay/runner.ts";
import { EXPLORE_JUDGE_MODEL } from "#src/explore/replay/judge.ts";
import { emitEvalReport } from "#src/explore/eval-report-output.ts";
import { exploreCapabilityEvalSha256 } from "#src/explore/capability-eval.ts";
import { scenarioDiscordTransport } from "#src/explore/scenarios/fake-discord.ts";
import { seedScenarioWorld } from "#src/explore/scenarios/fixtures.ts";
import type { ScenarioRunPlan } from "#src/explore/scenarios/plan.ts";
import {
  ScenarioEvalReportSchema,
  summarizeScenarioRuns,
  type ScenarioRunSummary,
} from "#src/explore/scenarios/report.ts";
import {
  buildScenarioWorld,
  renderScenarioQuestion,
  type ScenarioWorld,
} from "#src/explore/scenarios/world.ts";
import type { ScenarioCliOptions } from "./scenario-args.ts";
import {
  gradeTurn,
  historyFrom,
  resolveCaseAccounts,
} from "./scenario-turn.ts";

/** Explore's own turn ceiling, so a scenario times out where a user would. */
const TURN_TIMEOUT_MS = 180_000;
const REPORT_URL = new URL(
  "../../src/explore/explore-scenario-eval-report.json",
  import.meta.url,
);

type RunInput = {
  readonly options: ScenarioCliOptions;
  readonly plan: readonly ScenarioRunPlan[];
  readonly corpus: {
    readonly corpus: ExploreScenarioCorpus;
    readonly raw: string;
  };
  readonly lake: { readonly buildId: string; readonly buildDir: string };
  readonly bundleRoot: string;
};

/** Refuse to run if the guarded environment did not reach configuration. */
function assertEnvironment(): void {
  const problems = [
    configuration.environment === "dev"
      ? null
      : `configuration.environment is ${configuration.environment}, not dev`,
    configuration.databaseUrl === Bun.env["DATABASE_URL"]
      ? null
      : "configuration.databaseUrl is not the scenario database",
    path.resolve(configuration.reportLakeDir) ===
    path.resolve(Bun.env["REPORT_LAKE_DIR"] ?? "")
      ? null
      : "configuration.reportLakeDir is not the scenario lake",
  ].filter((problem) => problem !== null);
  if (problems.length > 0) {
    throw new Error(
      `Scenario environment did not take: ${problems.join("; ")}.`,
    );
  }
}

async function runOne(input: {
  readonly run: ScenarioRunPlan;
  readonly world: ScenarioWorld;
  readonly priorHistory: readonly ExploreMessage[];
  readonly runtime: ReturnType<typeof createLlmRuntime> | null;
  readonly bundleDir: string;
}): Promise<ScenarioRunSummary> {
  const { run, world } = input;
  const conversation = await prisma.exploreConversation.create({
    data: {
      userId: world.asker.id,
      title: `Scenario ${run.entry.id}`,
      origin: run.surface,
    },
  });
  let history: ExploreMessage[] = [...input.priorHistory];
  const transcript: { question: string; answer: string }[] =
    run.entry.priorTurns.map((turn) => ({
      question: turn.question,
      answer: turn.answer,
    }));
  const turns: ScenarioRunSummary["turns"][number][] = [];
  const evidence: unknown[] = [];

  for (const [index, turn] of run.entry.turns.entries()) {
    try {
      const question = renderScenarioQuestion(turn.question, world);
      const images =
        turn.image === undefined ? [] : [await loadScenarioImage(turn.image)];
      const observation = await runReplayCase(
        {
          caseId: `${run.entry.id}/${run.surface}/${index.toString()}`,
          kind: "conversation",
          conversationId: conversation.id,
          question,
          history,
          requesterId: world.asker.id,
          guildIds: [world.guildId],
          surface: run.surface,
          originChannelId:
            run.surface === "web" ? null : (world.channels[0]?.id ?? null),
          images,
        },
        {
          executeAgent: streamExploreAgent,
          resolveCapabilities: resolveReplayCapabilities,
          now: () => Date.now(),
          timeoutMs: TURN_TIMEOUT_MS,
          newRunId: () => globalThis.crypto.randomUUID(),
        },
      );

      const graded =
        turn.expect === undefined
          ? null
          : await gradeTurn({
              turn: { ...turn, expect: turn.expect },
              index,
              question,
              observation,
              world,
              surface: run.surface,
              transcript,
              runtime: input.runtime,
              // Web and Discord attach images; voice cannot.
              imageDelivered:
                turn.image === undefined
                  ? null
                  : images.length > 0 && run.surface !== "voice",
            });
      if (graded === null) {
        evidence.push({ index, question, observation });
      } else {
        turns.push(graded.summary);
        evidence.push(graded.evidence);
      }

      transcript.push({
        question,
        answer: observation.answer?.answer ?? "(This answer failed.)",
      });
      history = [
        ...history,
        ...historyFrom(
          question,
          observation,
          world,
          history.at(-1)?.id ?? null,
        ),
      ];
    } catch (error) {
      // A throw after paid turns keeps what they produced: the turns already
      // graded stay in the summary and the bundle, and this turn is recorded
      // as failed with its error, so a broken run never scores as a short
      // clean one.
      const message = error instanceof Error ? error.message : String(error);
      turns.push({
        index,
        status: "error",
        checks: [],
        rubric:
          turn.expect === undefined || input.runtime === null
            ? null
            : turn.expect.rubric.map(() => false),
        passed: false,
      });
      evidence.push({ index, question: turn.question, error: message });
      break;
    }
  }

  const summary: ScenarioRunSummary = {
    caseId: run.entry.id,
    surface: run.surface,
    control: run.entry.control,
    passed: turns.length > 0 && turns.every((turn) => turn.passed),
    turns,
  };
  await Bun.write(
    path.join(input.bundleDir, `${run.entry.id}.${run.surface}.json`),
    `${JSON.stringify({ summary, world, turns: evidence }, null, 2)}\n`,
  );
  return summary;
}

const SCENARIO_IMAGE_DIR = path.join(
  import.meta.dir,
  "../../src/explore/scenarios/images",
);

/** A case's fixture image, as the turn runner would read it from storage. */
async function loadScenarioImage(name: string): Promise<ExploreQuestionImage> {
  const bytes = new Uint8Array(
    await Bun.file(path.join(SCENARIO_IMAGE_DIR, name)).arrayBuffer(),
  );
  const mediaType = name.endsWith(".png")
    ? "image/png"
    : name.endsWith(".webp")
      ? "image/webp"
      : "image/jpeg";
  return { mediaType, bytes };
}
export async function runScenarios(
  input: RunInput,
): Promise<{ readonly passed: boolean }> {
  assertEnvironment();
  if (input.options.judge) requireCredentialsFor(EXPLORE_JUDGE_MODEL);
  requireCredentialsFor(input.options.model);

  await initializeDynamicConfig({
    environment: { ...Bun.env, FEATURE_FLAGS_MODE: "disabled" },
    provider: new ReplayRuntimeProvider({
      analysisEnabled: false,
      model: input.options.model,
    }),
    seed: {
      exploreGuildAllowlist: configuration.exploreGuildAllowlist,
      exploreQuotaLimits: configuration.exploreQuotaLimits,
      llmHourlyTokenBudget: configuration.llmHourlyTokenBudget,
      llmDailyTokenBudget: configuration.llmDailyTokenBudget,
      exploreModel: input.options.model,
      featureTipPercent: configuration.featureTipPercent,
      featureTipCooldownHours: configuration.featureTipCooldownHours,
      reportAiModel: configuration.reportAiModel ?? "gpt-5.6-sol",
      bettingParlayAiModel: configuration.bettingParlayAiModel ?? "gpt-5.6-sol",
      temporalCallGraphTracing: false,
    },
    startPolling: false,
  });

  try {
    const accounts = new Map<
      string,
      Awaited<ReturnType<typeof resolveCaseAccounts>>
    >();
    for (const run of input.plan) {
      if (!accounts.has(run.entry.id)) {
        accounts.set(
          run.entry.id,
          await resolveCaseAccounts(run, input.lake.buildDir),
        );
      }
    }
    const now = new Date();
    const worlds: {
      run: ScenarioRunPlan;
      world: ScenarioWorld;
      history: readonly ExploreMessage[];
    }[] = [];
    for (const run of input.plan) {
      const resolved = accounts.get(run.entry.id);
      if (resolved === undefined)
        throw new Error(`No accounts for ${run.entry.id}.`);
      const world = buildScenarioWorld({
        entry: run.entry,
        caseIndex: run.caseIndex,
        surface: run.surface,
        playerAccounts: resolved.players,
        candidates: resolved.candidates,
      });
      const { history } = await seedScenarioWorld({
        db: prisma,
        world,
        entry: run.entry,
        now,
      });
      worlds.push({ run, world, history });
      // Creation is the one capability a case controls; every other flag
      // keeps prod's registry default, as a real server would see it.
      for (const override of flagOverridesFor({
        bucks: false,
        dares: false,
        challenges: false,
        creation: run.entry.guild.creationEnabled,
        riotHistory: false,
        mvpVotes: false,
        clash: false,
        hallOfFame: false,
      })) {
        if (override.flag === "explore_creation_enabled") {
          addFlagOverride(override.flag, override.value, {
            server: world.guildId,
          });
        }
      }
    }

    // Guild scope in ScoutQL reads the lake's accounts file, which the lake
    // build derives from Postgres. Rewriting it from the seeded database is
    // what makes each fixture guild's players visible to a guild query.
    const accountRows = await writeAccountsParquet(prisma, input.lake.buildDir);
    process.stderr.write(
      `Seeded ${worlds.length.toString()} worlds; ${accountRows.toString()} fixture accounts in the lake.\n`,
    );

    const restoreDiscord = installBotRestReader(
      createBotRestReader({
        get: scenarioDiscordTransport({
          worlds: () => worlds.map((entry) => entry.world),
          botUserId: configuration.applicationId,
        }),
        botUserId: configuration.applicationId,
      }),
    );

    const runtime = input.options.judge
      ? createLlmRuntime({
          credentials: providerCredentialsFromEnv(),
          service: "scout-explore-scenario-evals",
          appName: "Scout Explore Scenario Evals",
        })
      : null;

    const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
    const bundleDir = path.join(input.bundleRoot, stamp);
    await mkdir(bundleDir, { recursive: true, mode: 0o700 });
    await chmod(bundleDir, 0o700);

    const summaries: (ScenarioRunSummary | undefined)[] = Array.from({
      length: worlds.length,
    });
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next;
        next += 1;
        const entry = worlds[index];
        if (entry === undefined) return;
        let summary: ScenarioRunSummary;
        try {
          summary = await runOne({
            run: entry.run,
            world: entry.world,
            priorHistory: entry.history,
            runtime,
            bundleDir,
          });
        } catch (error) {
          // One broken run is a failed run, not a lost eval: the other
          // workers keep the fixture Discord reader and the database.
          process.stderr.write(
            `ERROR ${entry.run.entry.id} [${entry.run.surface}]: ${error instanceof Error ? error.message : String(error)}\n`,
          );
          summary = {
            caseId: entry.run.entry.id,
            surface: entry.run.surface,
            control: entry.run.entry.control,
            passed: false,
            turns: [],
          };
        }
        summaries[index] = summary;
        process.stderr.write(
          `${summary.passed ? "PASS" : "FAIL"} ${summary.caseId} [${summary.surface}]\n`,
        );
      }
    };
    try {
      await Promise.all(
        Array.from(
          {
            length: Math.max(
              1,
              Math.min(input.options.concurrency, worlds.length),
            ),
          },
          () => worker(),
        ),
      );
    } finally {
      restoreDiscord();
    }

    const runs = summaries.map((summary, index) => {
      if (summary === undefined)
        throw new Error(`Run ${index.toString()} produced no summary.`);
      return summary;
    });
    const report = ScenarioEvalReportSchema.parse({
      version: 1,
      corpusVersion: input.corpus.corpus.version,
      corpusSha256: exploreCapabilityEvalSha256(input.corpus.raw),
      model: input.options.model,
      judgeModel: input.options.judge ? EXPLORE_JUDGE_MODEL : null,
      lakeBuildId: input.lake.buildId,
      generatedAt: new Date().toISOString(),
      passed: runs.every((run) => run.passed),
      summary: summarizeScenarioRuns(runs),
      runs,
    });
    process.stderr.write(`Bundle: ${bundleDir}\n`);
    await emitEvalReport(report, REPORT_URL);
    return { passed: report.passed };
  } finally {
    await prisma.$disconnect();
    await shutdownDynamicConfig();
    await closeDuckDB();
  }
}
