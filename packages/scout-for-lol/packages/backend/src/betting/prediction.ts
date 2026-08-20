import { rankToLeaguePoints, type Rank } from "@scout-for-lol/data";
import { PARTICIPANTS_PER_TEAM } from "#src/betting/constants.ts";

/**
 * Scout's own call on whether the tracked player wins.
 *
 * Deliberately a heuristic and not an LLM. The prematch poll runs every 30
 * seconds across up to 50 players, so anything that costs a network round trip
 * per game is unaffordable here — and a deterministic answer can be tested,
 * replayed, and scored for calibration later, which a sampled one cannot.
 *
 * Every input is either already in hand (ranks are fetched for all ten players
 * by `buildLoadingScreenData`) or a single local lake read. Nothing here issues
 * a Riot call.
 */

export type PredictionConfidence = "low" | "medium" | "high";

export type PredictionParticipant = {
  /** Rank in the queue being played, if the player is ranked in it. */
  rank: Rank | undefined;
  /** True for the side whose win probability is being predicted. */
  isSubjectTeam: boolean;
};

export type PredictionForm = {
  wins: number;
  games: number;
};

export type PredictionInput = {
  subjectAlias: string;
  participants: readonly PredictionParticipant[];
  /** The subject's recent games, from the report lake. Omitted on timeout. */
  recentForm?: PredictionForm | undefined;
  /** The subject's history on this champion, from the same rows. */
  championForm?: PredictionForm | undefined;
};

export type Prediction = {
  /** Probability the subject's team wins. Clamped away from certainty. */
  winProbability: number;
  confidence: PredictionConfidence;
  sentence: string;
  /** The terms that moved the number most, so the sentence explains itself. */
  drivers: string[];
};

/** Roughly one tier of League Points. Used to convert a rank gap into a
 * dimensionless quantity before it enters the logit. */
const LP_PER_TIER = 400;

/**
 * Coefficients. There is deliberately **no intercept**: a symmetric lobby must
 * come out at exactly 0.500, which is a test assertion rather than an
 * aspiration.
 */
const B_RANK = 0.55;
const B_WINRATE = 3;
const B_FORM = 1.2;
const B_CHAMPION = 0.8;

const MAX_RANK_Z = 1.5;
const MAX_WINRATE_DELTA = 0.25;

/** Fewer ranked players than this and the rank term says more about who is
 * unranked than about who is better, so it is dropped entirely. */
const MIN_RANKED_FOR_RANK_TERM = 4;
const MIN_RANKED_FOR_HIGH_CONFIDENCE = 8;

const MIN_GAMES_FOR_FORM = 5;
const MIN_GAMES_FOR_CHAMPION = 3;

/** Never state certainty. A 5% floor keeps an upset from reading as impossible
 * and keeps the displayed call useful. */
const MIN_PROBABILITY = 0.05;
const MAX_PROBABILITY = 0.95;

/** Predictions within five percentage points of even odds are not useful
 * enough to show as a call, but remain stored for later calibration. */
const COIN_FLIP_BAND = 0.05;
const MAX_SENTENCE_LENGTH = 120;

export function shouldDisplayPrediction(winProbability: number): boolean {
  // Compare the rounded percentage that readers see, so 45% and 55% stay in
  // the suppressed band without floating-point boundary surprises.
  return Math.abs(Math.round(winProbability * 100) - 50) > COIN_FLIP_BAND * 100;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/**
 * Beta(2, 2) shrinkage. A player who is 3-0 reads as 0.58 rather than 1.00,
 * which is what stops a tiny sample from dominating the blend.
 */
function shrunkWinRate(wins: number, losses: number): number {
  return (wins + 2) / (wins + losses + 4);
}

type Term = {
  name: string;
  contribution: number;
  describe: () => string;
};

/**
 * Rank gap between the two teams.
 *
 * Players unranked *in this queue* are imputed the mean of the ranked players
 * in the same lobby, not zero. Zero is Iron IV, and a smurf in a Diamond lobby
 * is emphatically not Iron IV — imputing it would wreck any game with a couple
 * of unranked accounts.
 */
function rankTerm(
  participants: readonly PredictionParticipant[],
): Term | undefined {
  const rankedLp = participants
    .filter((p) => p.rank !== undefined)
    .map((p) => rankToLeaguePoints(p.rank));

  if (rankedLp.length < MIN_RANKED_FOR_RANK_TERM) {
    return undefined;
  }

  const imputed = mean(rankedLp);
  const lpFor = (p: PredictionParticipant) =>
    p.rank === undefined ? imputed : rankToLeaguePoints(p.rank);

  const own = participants.filter((p) => p.isSubjectTeam).map((p) => lpFor(p));
  const enemy = participants
    .filter((p) => !p.isSubjectTeam)
    .map((p) => lpFor(p));
  if (own.length === 0 || enemy.length === 0) {
    return undefined;
  }

  const lpDelta = mean(own) - mean(enemy);
  const z = clamp(lpDelta / LP_PER_TIER, -MAX_RANK_Z, MAX_RANK_Z);

  return {
    name: "rank",
    contribution: B_RANK * z,
    describe: () => {
      const tiers = Math.abs(lpDelta / LP_PER_TIER).toFixed(1);
      return lpDelta >= 0
        ? `rank edge +${tiers} tiers`
        : `rank gap -${tiers} tiers`;
    },
  };
}

/** Season win rate across the lobby, using only players ranked in this queue —
 * an imputed rank carries no win/loss record to average. */
function winRateTerm(
  participants: readonly PredictionParticipant[],
): Term | undefined {
  const rateFor = (side: boolean) =>
    participants
      .filter((p) => p.isSubjectTeam === side && p.rank !== undefined)
      .map((p) => shrunkWinRate(p.rank?.wins ?? 0, p.rank?.losses ?? 0));

  const own = rateFor(true);
  const enemy = rateFor(false);
  if (own.length === 0 || enemy.length === 0) {
    return undefined;
  }

  const delta = clamp(
    mean(own) - mean(enemy),
    -MAX_WINRATE_DELTA,
    MAX_WINRATE_DELTA,
  );

  return {
    name: "winrate",
    contribution: B_WINRATE * delta,
    describe: () =>
      delta >= 0 ? "better season record" : "worse season record",
  };
}

function formTerm(
  form: PredictionForm | undefined,
  options: {
    minGames: number;
    prior: number;
    coefficient: number;
    name: string;
  },
): Term | undefined {
  if (form === undefined || form.games < options.minGames) {
    return undefined;
  }
  const rate = (form.wins + options.prior) / (form.games + options.prior * 2);
  const delta = clamp(rate - 0.5, -MAX_WINRATE_DELTA, MAX_WINRATE_DELTA);
  const losses = form.games - form.wins;

  return {
    name: options.name,
    contribution: options.coefficient * delta,
    describe: () =>
      options.name === "form"
        ? `${form.wins.toString()}-${losses.toString()} recent`
        : `${form.wins.toString()}-${losses.toString()} on champion`,
  };
}

function resolveConfidence(input: {
  hasRankTerm: boolean;
  rankedCount: number;
  logit: number;
}): PredictionConfidence {
  if (!input.hasRankTerm || Math.abs(input.logit) < 0.15) {
    return "low";
  }
  if (
    input.rankedCount >= MIN_RANKED_FOR_HIGH_CONFIDENCE &&
    Math.abs(input.logit) >= 0.5
  ) {
    return "high";
  }
  return "medium";
}

function buildSentence(input: {
  alias: string;
  probability: number;
  drivers: readonly string[];
}): string {
  const percent = Math.round(input.probability * 100);
  const detail =
    input.drivers.length > 0 ? ` (${input.drivers.join(", ")})` : "";

  const base =
    Math.abs(input.probability - 0.5) < COIN_FLIP_BAND
      ? `Scout's call: coin flip — ${percent.toString()}% for ${input.alias}.`
      : `Scout's call: ${input.alias} ${
          input.probability > 0.5 ? "WINS" : "LOSES"
        } — ${percent.toString()}%${detail}.`;

  if (base.length <= MAX_SENTENCE_LENGTH) {
    return base;
  }
  // Drop the explanation before the claim; a truncated reason is worse than
  // none, and the claim is the part that has to survive.
  return `Scout's call: ${input.alias} ${
    input.probability > 0.5 ? "WINS" : "LOSES"
  } — ${percent.toString()}%.`.slice(0, MAX_SENTENCE_LENGTH);
}

export function predictWin(input: PredictionInput): Prediction {
  const rank = rankTerm(input.participants);
  const winRate = winRateTerm(input.participants);
  const recent = formTerm(input.recentForm, {
    minGames: MIN_GAMES_FOR_FORM,
    prior: 5,
    coefficient: B_FORM,
    name: "form",
  });
  const champion = formTerm(input.championForm, {
    minGames: MIN_GAMES_FOR_CHAMPION,
    prior: 3,
    coefficient: B_CHAMPION,
    name: "champion",
  });

  const terms = [rank, winRate, recent, champion].filter(
    (term) => term !== undefined,
  );
  const logit = terms.reduce((total, term) => total + term.contribution, 0);

  const winProbability = clamp(
    1 / (1 + Math.exp(-logit)),
    MIN_PROBABILITY,
    MAX_PROBABILITY,
  );

  const rankedCount = input.participants.filter(
    (p) => p.rank !== undefined,
  ).length;

  const drivers = [...terms]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 2)
    .filter((term) => Math.abs(term.contribution) > 0)
    .map((term) => term.describe());

  return {
    winProbability,
    confidence: resolveConfidence({
      hasRankTerm: rank !== undefined,
      rankedCount,
      logit,
    }),
    sentence: buildSentence({
      alias: input.subjectAlias,
      probability: winProbability,
      drivers,
    }),
    drivers,
  };
}

/** Exported for the prematch builder, which must split a ten-player lobby into
 * the subject's side and the other one. */
export const EXPECTED_PARTICIPANTS = PARTICIPANTS_PER_TEAM * 2;
