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
  parseModelGeneratedParlay,
} from "#src/betting/parlay-model-schema.ts";
import {
  PARLAY_SYSTEM_PROMPT,
  ParlayGenerationContextSchema,
  buildParlayProposalPrompt,
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

for (const liveCase of cases) {
  const startedAt = Date.now();
  const result = await generateValidatedObject(runtime, {
    model,
    schema: generatedParlaySchemaFor(liveCase.selected),
    schemaName: "bryan_bucks_parlay",
    schemaDescription:
      "A fixed-odds AND parlay built only from the supplied closed catalog.",
    system: PARLAY_SYSTEM_PROMPT,
    prompt: buildParlayProposalPrompt(liveCase.context),
    workload: "scout.betting.parlay.live-acceptance",
    sessionId: liveCase.name,
    abortSignal: AbortSignal.timeout(PARLAY_GENERATION_DEADLINE_MS),
    reasoningEffort: "medium",
    maxOutputTokens: PARLAY_INITIAL_OUTPUT_TOKENS,
    semanticRetryMaxOutputTokens: PARLAY_RETRY_OUTPUT_TOKENS,
  });
  const durationMs = Date.now() - startedAt;
  if (durationMs > PARLAY_GENERATION_DEADLINE_MS) {
    throw new Error(`${liveCase.name} exceeded the 60-second deadline`);
  }
  const serialized = JSON.stringify(
    parseModelGeneratedParlay(result.object, 5000),
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
  if (
    roundTrip.yesProbabilityBps < 1000 ||
    roundTrip.yesProbabilityBps > 9000
  ) {
    throw new Error(`${liveCase.name} returned invalid odds`);
  }
  const rendered = renderParlay(roundTrip, liveCase.selected);
  if (
    rendered.length !== roundTrip.conditions.length ||
    rendered.some((leg) => leg.length === 0)
  ) {
    throw new Error(`${liveCase.name} could not be deterministically rendered`);
  }
  logger.info(
    `${liveCase.name}: ${durationMs.toString()}ms, ${roundTrip.conditions.length.toString()} legs, YES ${roundTrip.yesProbabilityBps.toString()} bps`,
  );
}
