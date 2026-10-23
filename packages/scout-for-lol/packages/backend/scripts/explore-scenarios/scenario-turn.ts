import { Output, generateText } from "ai";
import type { createLlmRuntime } from "@shepherdjerred/llm-runtime";
import { ExploreMessageSchema, type ExploreMessage } from "@scout-for-lol/data";
import type { ReplayObservation } from "#src/explore/replay/runner.ts";
import { EXPLORE_JUDGE_MODEL } from "#src/explore/replay/judge.ts";
import { scenarioTurnChecks } from "#src/explore/scenarios/grade.ts";
import {
  rubricResults,
  scenarioJudgeSystemPrompt,
  scenarioJudgeUserPrompt,
  ScenarioJudgementSchema,
  type ScenarioRubricResult,
} from "#src/explore/scenarios/judge.ts";
import { resolveScenarioAccount } from "#src/explore/scenarios/lake-accounts.ts";
import type { ScenarioRunPlan } from "#src/explore/scenarios/plan.ts";
import {
  turnPassed,
  type ScenarioRunSummary,
} from "#src/explore/scenarios/report.ts";
import type {
  ScenarioAccount,
  ScenarioWorld,
} from "#src/explore/scenarios/world.ts";

/**
 * One scenario turn: resolving its accounts, grading it, and turning its
 * answer into history for the next turn. Split from the run loop so each half
 * reads on its own.
 */

/** The accounts a case's fixtures resolve to; shared by all its surfaces. */
export async function resolveCaseAccounts(
  run: ScenarioRunPlan,
  buildDir: string,
): Promise<{
  readonly players: readonly ScenarioAccount[];
  readonly candidates: Readonly<Record<string, ScenarioAccount>>;
}> {
  const taken = new Set<string>();
  const players: ScenarioAccount[] = [];
  for (const player of run.entry.guild.players) {
    const account = await resolveScenarioAccount({
      buildDir,
      selector: player.account,
      exclude: taken,
    });
    taken.add(account.puuid);
    players.push(account);
  }
  const candidates: Record<string, ScenarioAccount> = {};
  for (const [name, selector] of Object.entries(run.entry.candidates)) {
    const account = await resolveScenarioAccount({
      buildDir,
      selector,
      exclude: taken,
    });
    taken.add(account.puuid);
    candidates[name] = account;
  }
  return { players, candidates };
}

export function historyFrom(
  question: string,
  observation: ReplayObservation,
  world: ScenarioWorld,
  parentId: string | null,
): readonly ExploreMessage[] {
  const askedAt = new Date().toISOString();
  const user = ExploreMessageSchema.parse({
    id: globalThis.crypto.randomUUID(),
    role: "user",
    parentId,
    content: question,
    createdAt: askedAt,
  });
  const answer = ExploreMessageSchema.parse({
    id: globalThis.crypto.randomUUID(),
    role: "assistant",
    parentId: user.id,
    content: observation.answer?.answer ?? "(This answer failed.)",
    queryText: observation.answer?.queryText ?? null,
    caveats: observation.answer?.caveats ?? [],
    followUps: observation.answer?.followUps ?? [],
    guildIds: [world.guildId],
    trace: observation.trace,
    createdAt: new Date().toISOString(),
  });
  return [user, answer];
}

async function judgeTurn(input: {
  readonly runtime: ReturnType<typeof createLlmRuntime>;
  readonly prompt: string;
  readonly rubric: readonly string[];
}): Promise<readonly ScenarioRubricResult[]> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const result = await generateText({
        model: input.runtime.languageModel(EXPLORE_JUDGE_MODEL),
        system: scenarioJudgeSystemPrompt(),
        prompt: input.prompt,
        output: Output.object({ schema: ScenarioJudgementSchema }),
        ...input.runtime.callOptions({
          workload: "scout.explore.scenario-judge",
          model: EXPLORE_JUDGE_MODEL,
          promptCacheKey: "scout.explore.scenario-judge",
        }),
      });
      return rubricResults(input.rubric, result.output);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      // Only an empty provider response is retried; a judge that cannot read
      // an answer must still fail rather than be retried into a verdict.
      if (
        !message.includes("No output generated") &&
        !message.includes("No object generated") &&
        !message.includes("empty response")
      ) {
        throw error;
      }
    }
  }
  throw lastError;
}

type ScenarioTurn = ScenarioRunPlan["entry"]["turns"][number];

/** Deterministic checks plus the rubric judge, for one turn that has expectations. */
export async function gradeTurn(input: {
  readonly turn: ScenarioTurn & {
    readonly expect: NonNullable<ScenarioTurn["expect"]>;
  };
  readonly index: number;
  readonly question: string;
  readonly observation: ReplayObservation;
  readonly world: ScenarioWorld;
  readonly surface: ScenarioRunPlan["surface"];
  readonly transcript: readonly { question: string; answer: string }[];
  readonly runtime: ReturnType<typeof createLlmRuntime> | null;
  /** Whether the turn's fixture image was attached; null without one. */
  readonly imageDelivered: boolean | null;
}): Promise<{
  readonly summary: ScenarioRunSummary["turns"][number];
  readonly evidence: unknown;
}> {
  const { turn, observation } = input;
  const answer = observation.answer;
  const checks = scenarioTurnChecks({
    expect: turn.expect,
    evidence: {
      surface: input.surface,
      answer:
        answer === null
          ? null
          : {
              answer: answer.answer,
              spokenAnswer: answer.spokenAnswer ?? undefined,
              followUps: answer.followUps,
            },
      trace: observation.trace,
      imageDelivered: input.imageDelivered,
    },
    hasImage: turn.image !== undefined,
  });
  // A judge failure is the judge's, not Explore's: the answer, trace and
  // checks are kept, and every criterion reads as unmet with the reason.
  let rubric: readonly ScenarioRubricResult[] | null = null;
  if (input.runtime !== null) {
    try {
      rubric = await judgeTurn({
        runtime: input.runtime,
        rubric: turn.expect.rubric,
        prompt: scenarioJudgeUserPrompt({
          world: input.world,
          surface: input.surface,
          conversation: input.transcript,
          question: input.question,
          answer: answer?.answer ?? null,
          spokenAnswer:
            input.surface === "voice" ? (answer?.spokenAnswer ?? null) : null,
          followUps: answer?.followUps ?? [],
          trace: observation.trace,
          payloads: observation.payloads.map((payload) => ({
            toolCallId: payload.toolCallId,
            direction: payload.direction,
            value: payload.value,
          })),
          rubric: turn.expect.rubric,
        }),
      });
    } catch (error) {
      const reason = `The judge failed: ${error instanceof Error ? error.message : String(error)}`;
      rubric = turn.expect.rubric.map((criterion) => ({
        criterion,
        met: false,
        reason,
      }));
    }
  }
  const verdicts = rubric?.map((result) => result.met) ?? null;
  return {
    summary: {
      index: input.index,
      status: observation.status,
      checks: checks.map((check) => ({
        name: check.name,
        passed: check.passed,
      })),
      rubric: verdicts,
      passed: turnPassed({
        status: observation.status,
        checks,
        rubric: verdicts,
      }),
    },
    evidence: {
      index: input.index,
      question: input.question,
      observation,
      checks,
      rubric,
    },
  };
}
