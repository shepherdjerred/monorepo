import {
  createOpenRouterRuntime,
  generateValidatedObject,
} from "@shepherdjerred/llm-runtime";
import { LeaguePuuidSchema } from "@scout-for-lol/data";
import {
  DEFAULT_PARLAY_AI_MODEL,
  PARLAY_GENERATION_DEADLINE_MS,
  PARLAY_INITIAL_OUTPUT_TOKENS,
  PARLAY_RETRY_OUTPUT_TOKENS,
} from "#src/betting/constants.ts";
import {
  GeneratedParlaySchema,
  ParlaySubjectsSchema,
  parlaySemanticIssues,
  renderParlay,
  selectParlayTeam,
  type ParlaySubject,
} from "#src/betting/parlay-criteria.ts";
import {
  generatedParlaySchemaFor,
  parlayProposalSchemaFor,
  parseModelGeneratedParlay,
  thresholdsMatchProposal,
} from "#src/betting/parlay-model-schema.ts";
import {
  buildPlayerFrame,
  statLegsForProposal,
} from "#src/betting/parlay-stats.ts";
import {
  OPPONENT_PING_HISTORY_COLUMNS,
  PARLAY_HISTORY_COLUMNS,
  TEAM_OBJECTIVE_HISTORY_COLUMNS,
} from "#src/betting/parlay-stat-fields.ts";
import {
  numericThresholdsAreMeasured,
  priceParlay,
} from "#src/betting/parlay-pricing.ts";
import type {
  ParlayHistory,
  ParlayHistoryMatch,
} from "#src/betting/parlay-history.ts";
import {
  PARLAY_SYSTEM_PROMPT,
  ParlayGenerationContextSchema,
  buildParlayProposalPrompt,
  buildParlayThresholdPrompt,
} from "#src/betting/parlay-prompt.ts";
import { createLogger } from "#src/logger.ts";

const logger = createLogger("test-parlay-live");

const apiKey = Bun.env["OPENROUTER_API_KEY"];
if (apiKey === undefined || apiKey.length === 0) {
  throw new Error("OPENROUTER_API_KEY is required for test:parlay:live");
}
const model = Bun.env["BETTING_PARLAY_AI_MODEL"] ?? DEFAULT_PARLAY_AI_MODEL;
const runtime = createOpenRouterRuntime({
  apiKey,
  service: "scout-parlay-live-acceptance",
  appName: "Scout for LoL Parlay Acceptance",
});

function puuid(index: number) {
  return LeaguePuuidSchema.parse(
    `live-${index.toString().padStart(2, "0")}`.padEnd(78, "x"),
  );
}

function subjects(count: number) {
  return ParlaySubjectsSchema.parse(
    Array.from({ length: count }, (_unused, index) => ({
      key: `P${(index + 1).toString()}`,
      puuid: puuid(index),
      alias: `Tracked ${(index + 1).toString()}`,
    })),
  );
}

function form(available: boolean, games: number) {
  return {
    available,
    games,
    wins: Math.floor(games / 2),
    averageKills: available ? 6.2 : 0,
    averageDeaths: available ? 5.1 : 0,
    averageAssists: available ? 8.7 : 0,
    averageCreepScore: available ? 174 : 0,
  };
}

function scenario(input: {
  queue: "solo" | "flex";
  subjectCount: number;
  historyAvailable: boolean;
  opposingTracked?: boolean;
  selected?: readonly ParlaySubject[];
}) {
  const selected = ParlaySubjectsSchema.parse(
    input.selected ?? subjects(input.subjectCount),
  );
  const context = ParlayGenerationContextSchema.parse({
    queue: input.queue,
    selectedSubjects: selected.map((subject) => subject.key),
    lobby: Array.from({ length: 10 }, (_unused, index) => {
      const subject = selected[index];
      const selectedTeam = index < 5;
      return {
        key:
          subject?.key ??
          `${selectedTeam ? "S" : "O"}${(index + 1).toString()}`,
        team: selectedTeam ? "selected" : "opponent",
        champion: [
          "Ahri",
          "Lee Sin",
          "Jinx",
          "Nautilus",
          "Garen",
          "Orianna",
          "Vi",
          "Kai'Sa",
          "Thresh",
          "Ornn",
        ][index],
        role: [
          "MIDDLE",
          "JUNGLE",
          "BOTTOM",
          "UTILITY",
          "TOP",
          "MIDDLE",
          "JUNGLE",
          "BOTTOM",
          "UTILITY",
          "TOP",
        ][index],
        rank: index % 2 === 0 ? "Emerald IV" : "Platinum I",
        tracked:
          subject !== undefined ||
          (input.opposingTracked === true && index === 5),
      };
    }),
    history: selected.map((subject) => ({
      subject: subject.key,
      overall: form(input.historyAvailable, input.historyAvailable ? 30 : 0),
      currentChampion: form(
        input.historyAvailable,
        input.historyAvailable ? 6 : 0,
      ),
    })),
  });
  return { selected, context };
}

function selectedForOpposingAnomaly() {
  const tracked = subjects(3);
  const selected = selectParlayTeam(
    Array.from({ length: 10 }, (_unused, index) => ({
      puuid: puuid(index),
      teamId: index < 5 ? (100 as const) : (200 as const),
      championId: index + 1,
      trackedAlias:
        index === 0
          ? tracked[0]?.alias
          : index === 1
            ? tracked[1]?.alias
            : index === 5
              ? tracked[2]?.alias
              : undefined,
    })),
  );
  if (selected?.teamId !== 100) {
    throw new Error("opposing-team fixture did not select the 2-player team");
  }
  return selected.subjects;
}

const cases = [
  {
    name: "solo-one-with-history",
    ...scenario({ queue: "solo", subjectCount: 1, historyAvailable: true }),
  },
  {
    name: "solo-duo-no-history",
    ...scenario({ queue: "solo", subjectCount: 2, historyAvailable: false }),
  },
  {
    name: "flex-five",
    ...scenario({ queue: "flex", subjectCount: 5, historyAvailable: true }),
  },
  {
    name: "opposing-team-anomaly",
    ...scenario({
      queue: "flex",
      subjectCount: 2,
      historyAvailable: true,
      opposingTracked: true,
      selected: selectedForOpposingAnomaly(),
    }),
  },
] as const;

/**
 * Synthetic history, so the acceptance run exercises the real stat and pricing
 * code without a lake.
 *
 * Values are spread deterministically so every distribution is non-degenerate:
 * the point is to check that the production prompts and schemas survive a real
 * model round trip, not to assert any particular threshold.
 */
function syntheticHistory(
  subjectList: readonly ParlaySubject[],
): ParlayHistory {
  // Derived from the same maps fetchParlayHistory selects, so the fixture
  // covers every field the model is allowed to propose. Hand-listing columns
  // here previously left 22 of 39 uncovered, and the run failed as
  // "unpriceable" on a leg the production fetch would have answered fine.
  const playerColumns = Object.values(PARLAY_HISTORY_COLUMNS).flatMap(
    (column) => (column === null ? [] : [column]),
  );
  const teamColumns = Object.values(TEAM_OBJECTIVE_HISTORY_COLUMNS).flatMap(
    (column) => (column === null ? [] : [column]),
  );
  const opponentColumns = Object.values(OPPONENT_PING_HISTORY_COLUMNS);

  const history = new Map<string, ParlayHistoryMatch[]>();
  for (const [subjectIndex, subject] of subjectList.entries()) {
    const matches: ParlayHistoryMatch[] = Array.from(
      { length: 60 },
      (_unused, index) => {
        const spread = (index * 7 + subjectIndex * 3) % 20;
        return {
          matchId: `LIVE_${subject.key}_${index.toString()}`,
          createdAtMs: 1_700_000_000_000 + index,
          durationSeconds: 1500 + ((index * 137) % 1500),
          win: index % 2 === 0,
          lane: "MIDDLE",
          values: new Map(playerColumns.map((column) => [column, spread + 3])),
          teamValues: new Map(
            teamColumns.map((column) => [column, spread % 5]),
          ),
          opponentValues: new Map(
            opponentColumns.map((column) => [column, spread * 2]),
          ),
        };
      },
    );
    history.set(subject.puuid, matches);
  }
  return history;
}

for (const liveCase of cases) {
  const startedAt = Date.now();
  const deadline = AbortSignal.timeout(PARLAY_GENERATION_DEADLINE_MS);
  const call = async (
    schema: Parameters<typeof generateValidatedObject>[1]["schema"],
    prompt: string,
    name: string,
  ) =>
    await generateValidatedObject(runtime, {
      model,
      schema,
      schemaName: name,
      schemaDescription:
        "A fixed-odds AND parlay built only from the supplied closed catalog.",
      system: PARLAY_SYSTEM_PROMPT,
      prompt,
      workload: "scout.betting.parlay.live-acceptance",
      sessionId: liveCase.name,
      abortSignal: deadline,
      reasoningEffort: "medium",
      maxOutputTokens: PARLAY_INITIAL_OUTPUT_TOKENS,
      semanticRetryMaxOutputTokens: PARLAY_RETRY_OUTPUT_TOKENS,
    });

  // Pass one: legs only.
  const proposalResult = await call(
    parlayProposalSchemaFor(liveCase.selected),
    buildParlayProposalPrompt(liveCase.context),
    "bryan_bucks_parlay_proposal",
  );
  const proposal = parlayProposalSchemaFor(liveCase.selected).parse(
    proposalResult.object,
  );

  const history = syntheticHistory(liveCase.selected);
  const legs = statLegsForProposal(proposal, liveCase.selected);
  if (legs.length === 0) {
    throw new Error(`${liveCase.name} proposed no measurable leg`);
  }
  const statistics = legs.map((leg) => ({
    condition: leg.index,
    describes: leg.label,
    subject: leg.subjectKey,
    operator: leg.operator,
    player: buildPlayerFrame({
      matches:
        leg.subjectPuuid === null ? [] : (history.get(leg.subjectPuuid) ?? []),
      column: leg.column,
      operator: leg.operator,
      team: leg.scope === "team",
      opponent: leg.scope === "opponent",
    }),
  }));

  // Pass two: numbers only.
  const filledResult = await call(
    generatedParlaySchemaFor(liveCase.selected),
    buildParlayThresholdPrompt({
      context: liveCase.context,
      proposal,
      statistics,
    }),
    "bryan_bucks_parlay",
  );
  const filled = generatedParlaySchemaFor(liveCase.selected).parse(
    filledResult.object,
  );

  const durationMs = Date.now() - startedAt;
  if (durationMs > PARLAY_GENERATION_DEADLINE_MS) {
    throw new Error(`${liveCase.name} exceeded the 60-second deadline`);
  }
  if (!thresholdsMatchProposal(proposal, filled)) {
    throw new Error(
      `${liveCase.name} changed its proposed legs in the threshold pass`,
    );
  }

  const candidate = parseModelGeneratedParlay(filled, 5000);
  if (
    !numericThresholdsAreMeasured(
      candidate.conditions,
      liveCase.selected,
      history,
    )
  ) {
    throw new Error(
      `${liveCase.name} returned thresholds outside the measured 40-70% hit-rate range`,
    );
  }

  const priced = priceParlay({
    conditions: candidate.conditions,
    subjects: liveCase.selected,
    history,
  });
  if (priced === undefined) {
    throw new Error(
      `${liveCase.name} could not be priced from history; legs: ${legs
        .map((leg) => `${leg.label}/${leg.scope}`)
        .join(", ")}`,
    );
  }

  const serialized = JSON.stringify(
    parseModelGeneratedParlay(filled, priced.yesProbabilityBps),
  );
  const roundTrip = GeneratedParlaySchema.parse(JSON.parse(serialized));
  if (roundTrip.conditions.length < 2 || roundTrip.conditions.length > 6) {
    throw new Error(`${liveCase.name} returned an invalid leg count`);
  }
  const issues = parlaySemanticIssues(roundTrip, liveCase.selected);
  if (issues.length > 0) {
    throw new Error(
      `${liveCase.name} failed semantic validation: ${issues.join("; ")}`,
    );
  }
  const rendered = renderParlay(roundTrip, liveCase.selected);
  if (
    rendered.length !== roundTrip.conditions.length ||
    rendered.some((leg) => leg.length === 0)
  ) {
    throw new Error(`${liveCase.name} could not be deterministically rendered`);
  }
  logger.info(
    `${liveCase.name}: ${durationMs.toString()}ms, ${roundTrip.conditions.length.toString()} legs, measured YES ${roundTrip.yesProbabilityBps.toString()} bps via ${priced.method}`,
  );
  for (const leg of rendered) {
    logger.info(`  - ${leg}`);
  }
}
