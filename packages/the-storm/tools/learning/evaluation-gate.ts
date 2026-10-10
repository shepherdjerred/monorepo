import { z } from "zod";
import contract from "./evaluation.json";
import { MapBinding, MapCatalog } from "./maps/plan.ts";
import { isDeepStrictEqual } from "node:util";

if (
  contract.version !== 2 ||
  contract.mapSelection !== "balanced-contiguous-pairs" ||
  contract.matchesPerOpponent !== 200 ||
  contract.firstSeed !== 500_000_000 ||
  JSON.stringify(contract.opponents) !== '["authored","basic"]' ||
  JSON.stringify(contract.sides) !== '["red","blue"]' ||
  contract.minimumWins.authored !== 120 ||
  contract.minimumWins.basic !== 160 ||
  contract.minimumControlCoveragePercent !== 80
)
  throw new Error("unsupported strength evaluation contract");

const Digest = z.string().regex(/^[a-f0-9]{64}$/u);
const Count = z.number().int().nonnegative();
const Metric = z.number().nonnegative();
export const EvaluationGame = z
  .object({
    ...MapBinding.shape,
    engine: z.literal("Paper"),
    opponent: z.enum(["authored", "basic"]),
    seed: z.number().int().min(0).max(1_000_000_100),
    side: z.enum(["red", "blue"]),
    match: z.uuid(),
    result: z.enum(["win", "loss", "draw", "timeout"]),
    frames: Count.positive(),
    submitted_controls: Count,
    confirmed_controls: Count,
    applied_controls: Count,
    authored_fallbacks: Count,
    missed_ticks: Count,
    rejected_actions: Count,
    memory_resets: Count,
    dealt: Metric,
    received: Metric,
    seconds: Metric,
    max_inference_ms: Metric,
  })
  .strict()
  .refine(
    (game) =>
      game.confirmed_controls <= game.submitted_controls &&
      game.submitted_controls <= game.frames &&
      game.applied_controls <= game.frames,
  );
export const EvaluationReport = z
  .object({
    version: z.literal(2),
    engine: z.literal("Paper"),
    mode: z.enum(["pilot", "diagnostic"]),
    acceptance: z.literal("unaccepted"),
    actor_seed: z.number().int().min(0).max(1_000_000_000),
    weights_sha256: Digest,
    manifest_sha256: Digest,
    maps: MapCatalog,
    games: z.array(EvaluationGame),
    optimized: z.literal(false),
    retried_duels: z.literal(0),
    blind_preference_checked: z.literal(false),
    pilot_acceptance_checked: z.literal(false),
  })
  .strict();

if (
  !isDeepStrictEqual(
    contract.reportFields,
    Object.keys(EvaluationReport.shape),
  ) ||
  !isDeepStrictEqual(contract.gameFields, Object.keys(EvaluationGame.shape))
)
  throw new Error(
    "Strength validators differ from their neutral field inventory",
  );

export function evaluationSchedule(
  matches: number,
  firstSeed: number,
  rawMaps: MapBinding[],
) {
  if (!Number.isInteger(matches) || matches < 2 || matches > 200 || matches % 2)
    throw new Error(
      "evaluation needs paired sides and at most 200 games per opponent",
    );
  z.number().int().min(0).max(1_000_000_000).parse(firstSeed);
  const maps = MapCatalog.parse(rawMaps);
  const pairs = matches / 2;
  if (pairs < maps.length)
    throw new Error("Evaluation cannot cover every admitted map on both sides");
  return maps.flatMap((binding, mapIndex) =>
    (["authored", "basic"] as const).flatMap((opponent) =>
      Array.from({ length: pairs }, (_, index) => index)
        .filter(
          (index) => Math.floor((index * maps.length) / pairs) === mapIndex,
        )
        .flatMap((index) =>
          (["red", "blue"] as const).map((side) => ({
            ...binding,
            opponent,
            seed: firstSeed + index,
            side,
          })),
        ),
    ),
  );
}

/** Recompute from every scheduled outcome; incomplete or repeated evidence fails. */
export function strengthResult(
  raw: unknown,
  matches: number,
  firstSeed: number,
  maps: MapBinding[],
) {
  const report = EvaluationReport.parse(raw);
  const schedule = evaluationSchedule(matches, firstSeed, maps);
  if (
    !isDeepStrictEqual(report.maps, maps) ||
    report.games.length !== schedule.length ||
    new Set(report.games.map((game) => game.match)).size !== schedule.length ||
    report.games.some((game, index) => {
      const expected = schedule[index];
      return (
        game.seed !== expected?.seed ||
        game.side !== expected.side ||
        game.opponent !== expected.opponent ||
        game.map !== expected.map ||
        game.blocksSha256 !== expected.blocksSha256 ||
        game.scenarioSha256 !== expected.scenarioSha256
      );
    })
  )
    throw new Error("evaluation evidence differs from the frozen schedule");
  if (
    report.mode === "pilot" &&
    (matches !== contract.matchesPerOpponent ||
      firstSeed !== contract.firstSeed)
  )
    throw new Error("pilot strength requires the fixed 200-game gates");
  const opponents = contract.opponents.map((opponent) => {
    const games = report.games.filter((game) => game.opponent === opponent);
    const wins = games.filter((game) => game.result === "win").length;
    const minimumWins =
      opponent === "authored"
        ? contract.minimumWins.authored
        : contract.minimumWins.basic;
    const controlCoverage = contract.sides.map((side) => {
      const sideGames = games.filter((game) => game.side === side);
      const frames = sideGames.reduce((sum, game) => sum + game.frames, 0);
      const submitted = sideGames.reduce(
        (sum, game) => sum + game.submitted_controls,
        0,
      );
      const confirmed = sideGames.reduce(
        (sum, game) => sum + game.confirmed_controls,
        0,
      );
      const applied = sideGames.reduce(
        (sum, game) => sum + game.applied_controls,
        0,
      );
      const coverage = {
        submitted: (submitted / frames) * 100,
        confirmed: (confirmed / frames) * 100,
        applied: (applied / frames) * 100,
      };
      return {
        side,
        frames,
        submittedControls: submitted,
        confirmedControls: confirmed,
        appliedControls: applied,
        ...coverage,
        passed: Object.values(coverage).every(
          (percent) => percent >= contract.minimumControlCoveragePercent,
        ),
      };
    });
    return {
      opponent,
      games: games.length,
      wins,
      losses: games.filter((game) => game.result === "loss").length,
      draws: games.filter((game) => game.result === "draw").length,
      timeouts: games.filter((game) => game.result === "timeout").length,
      redWins: games.filter(
        (game) => game.side === "red" && game.result === "win",
      ).length,
      blueWins: games.filter(
        (game) => game.side === "blue" && game.result === "win",
      ).length,
      minimumWins,
      minimumControlCoveragePercent: contract.minimumControlCoveragePercent,
      controlCoverage,
      passed:
        report.mode === "pilot" &&
        wins >= minimumWins &&
        controlCoverage.every((coverage) => coverage.passed),
      appliedControls: games.reduce(
        (sum, game) => sum + game.applied_controls,
        0,
      ),
      authoredFallbacks: games.reduce(
        (sum, game) => sum + game.authored_fallbacks,
        0,
      ),
      missedTicks: games.reduce((sum, game) => sum + game.missed_ticks, 0),
      rejectedActions: games.reduce(
        (sum, game) => sum + game.rejected_actions,
        0,
      ),
    };
  });
  return {
    report,
    opponents,
    passed: opponents.every((opponent) => opponent.passed),
  };
}
