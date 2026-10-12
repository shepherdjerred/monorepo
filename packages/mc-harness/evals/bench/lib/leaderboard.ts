import {
  judgeFingerprint,
  rubricAxisIds,
  scoreFingerprint,
} from "#build/judge.ts";
import {
  scoreBy,
  type Entry,
  type EntryMeta,
  type ScoreRecord,
  type TournamentFile,
} from "#evals/bench/lib/entries.ts";

export type TaskBoard = {
  task: string;
  rubric: Entry["meta"]["rubric"];
  entries: Entry[];
  tournament: TournamentFile | null;
};

const thousands = (value: number): string => `${(value / 1000).toFixed(0)}k`;

/** Shown where a rating or score was taken of a sheet that has since been replaced. */
const STALE = "— (sheet changed, re-judge)";
/** Shown where another sheet in the round (an anchor, say) has been replaced since the round was judged. */
const STALE_ROUND = "— (a sheet in the round changed, re-judge)";
/** Shown where the tournament was judged under an earlier pair prompt or rubric. */
const OLD_JUDGE = "— (judge changed, re-judge)";
const STALE_ANCHORS = "— (anchors changed, re-judge)";

function currentAnchors(board: TaskBoard): boolean {
  if (board.tournament === null) return false;
  const anchors = new Set(
    board.entries
      .filter((entry) => entry.meta.anchor)
      .map((entry) => entry.meta.id),
  );
  return (
    anchors.size === board.tournament.anchors.length &&
    board.tournament.anchors.every((id) => anchors.has(id))
  );
}

/**
 * The entry's rating from the board's tournament, or null when it was not
 * rated, the judging policy has changed since, or its sheet has changed
 * since (re-collecting a run or regenerating an anchor replaces `sheet.jpg`
 * under the same id).
 */
/** True when the board's tournament was judged under the current pair prompt and rubric. */
function currentJudge(board: TaskBoard): boolean {
  return (
    board.tournament !== null &&
    board.tournament.judge === judgeFingerprint(board.rubric)
  );
}

/**
 * True when every sheet the tournament was judged on is still the sheet its
 * entry has. A rating is fitted from every pair in the round, so one
 * regenerated anchor or re-collected entry makes every rating stale, not
 * just its own row.
 */
function currentRound(board: TaskBoard): boolean {
  if (board.tournament === null || !currentAnchors(board)) return false;
  const current = new Map(
    board.entries.map((entry) => [entry.meta.id, entry.sheetSha256]),
  );
  return Object.entries(board.tournament.sheets).every(
    ([id, sha]) => current.get(id) === sha,
  );
}

function ratingOf(
  board: TaskBoard,
  entry: Entry,
): TournamentFile["ratings"][string] | null {
  const rating = board.tournament?.ratings[entry.meta.id];
  return rating !== undefined && currentJudge(board) && currentRound(board)
    ? rating
    : null;
}

/** Why a rated entry shows no rating: the judge moved on, its own sheet changed, or another sheet in its round did. */
function staleReason(board: TaskBoard, entry: Entry): string {
  if (!currentJudge(board)) return OLD_JUDGE;
  if (!currentAnchors(board)) return STALE_ANCHORS;
  return board.tournament?.sheets[entry.meta.id] === entry.sheetSha256
    ? STALE_ROUND
    : STALE;
}

function ratingCell(board: TaskBoard, entry: Entry): string {
  const rating = ratingOf(board, entry);
  if (rating === null) {
    return board.tournament?.ratings[entry.meta.id] === undefined
      ? "—"
      : staleReason(board, entry);
  }
  return `${rating.rating.toFixed(0)} [${rating.lo.toFixed(0)}, ${rating.hi.toFixed(0)}] (${rating.wins.toString()}/${rating.games.toString()})`;
}

/** The score the board shows: the tournament's model under the current scorer prompt, of the current sheet. */
function boardScore(board: TaskBoard, entry: Entry): ScoreRecord | null {
  if (board.tournament === null) return null;
  const record = scoreBy(entry.scores, {
    model: board.tournament.model,
    judge: scoreFingerprint(board.rubric),
  });
  if (record === null) return null;
  return record.sheetSha256 === entry.sheetSha256 ? record : null;
}

/** True when this judge scored the entry, but of a sheet that has since been replaced. */
function scoreStale(board: TaskBoard, entry: Entry): boolean {
  return (
    board.tournament !== null &&
    scoreBy(entry.scores, {
      model: board.tournament.model,
      judge: scoreFingerprint(board.rubric),
    }) !== null &&
    boardScore(board, entry) === null
  );
}

function scoreCell(board: TaskBoard, entry: Entry): string {
  const scores = boardScore(board, entry);
  if (scores === null) return scoreStale(board, entry) ? STALE : "—";
  return `${scores.total.toString()}/${scores.max.toString()} · æ ${scores.overallAesthetic.toString()}`;
}

/** A record's score on one axis; the schema guarantees every axis is present, so a gap is a bug, not a zero. */
function axisOf(scores: ScoreRecord, id: string): number {
  const value = scores.axes[id];
  if (value === undefined) {
    throw new Error(`score record for ${scores.rubric} has no axis ${id}`);
  }
  return value;
}

function axesCell(board: TaskBoard, entry: Entry): string {
  const scores = boardScore(board, entry);
  return scores === null
    ? "—"
    : rubricAxisIds(board.rubric)
        .map((id) => axisOf(scores, id).toString())
        .join(" ");
}

function usageCell(entry: Entry): string {
  const usage = entry.meta.usage;
  if (usage === null) return "—";
  return `${thousands(usage.inputTokens)}/${thousands(usage.outputTokens)}${usage.costUsd === undefined ? "" : ` $${usage.costUsd.toFixed(2)}`}`;
}

function sortedEntries(board: TaskBoard): Entry[] {
  return board.entries.toSorted((x, y) => {
    const rx = ratingOf(board, x)?.rating ?? Number.NEGATIVE_INFINITY;
    const ry = ratingOf(board, y)?.rating ?? Number.NEGATIVE_INFINITY;
    return rx === ry ? x.meta.id.localeCompare(y.meta.id) : ry - rx;
  });
}

/** Iterations, with the critique totals when the journal recorded any. */
function iterationsCell(meta: EntryMeta): string {
  const trajectory = meta.trajectory;
  if (trajectory === undefined) return "—";
  const critiques =
    trajectory.critiques.length === 0
      ? ""
      : ` (${trajectory.critiques.join("→")})`;
  return `${trajectory.iterations.toString()}${critiques}`;
}

export function renderTaskBoard(board: TaskBoard): string {
  const axes = rubricAxisIds(board.rubric).join(" ");
  const rows = sortedEntries(board).map((entry) => {
    const { meta } = entry;
    const name = meta.anchor
      ? `**${meta.id}**${meta.weak ? " (weak)" : ""}`
      : meta.id;
    return `| ${name} | ${ratingCell(board, entry)} | ${scoreCell(board, entry)} | ${axesCell(board, entry)} | ${meta.checks.passed.toString()}/${meta.checks.total.toString()} | ${meta.lint.warnings.toString()} | ${meta.repetition.toFixed(2)} | ${iterationsCell(meta)} | ${meta.seconds === null ? "—" : `${meta.seconds.toString()} s`} | ${usageCell(entry)} |`;
  });
  const judged =
    board.tournament === null
      ? "not yet judged"
      : `judged ${board.tournament.at} by ${board.tournament.model}, ${board.tournament.pairs.length.toString()} pairs`;
  return [
    `## ${board.task} (${board.rubric}) — ${judged}`,
    "",
    `| Entry | Rating [90% CI] (wins/games) | Absolute | ${axes} | Checks | Lint warn | Repeat | Iters | Time | Tokens in/out |`,
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...(rows.length > 0 ? rows : ["| (no entries) | | | | | | | | | |"]),
    "",
  ].join("\n");
}

export function renderLeaderboard(boards: readonly TaskBoard[]): string {
  return [
    "# Minecraft build bench",
    "",
    "Ratings are Bradley–Terry from order-swapped pairwise judgments, on an Elo-like scale centred so the anchors average 1000. Absolute scores are 0–5 per rubric axis (functional axes first, look axes last) with the aesthetic question (æ) asked separately. Regenerate with `bun packages/mc-harness/evals/bench/bench.ts report`.",
    "",
    ...boards.map((board) => renderTaskBoard(board)),
  ].join("\n");
}

export type IndexedEntry = {
  id: string;
  anchor: boolean;
  weak: boolean;
  head: string;
  agent: string | null;
  rating: TournamentFile["ratings"][string] | null;
  absolute: {
    total: number;
    max: number;
    overallAesthetic: number;
    axes: Record<string, number>;
  } | null;
  checks: Entry["meta"]["checks"];
  lint: Entry["meta"]["lint"];
  repetition: number;
  seconds: number | null;
  usage: Entry["meta"]["usage"];
};

export type TaskIndex = {
  task: string;
  rubric: Entry["meta"]["rubric"];
  judgedAt: string | null;
  model: string | null;
  entries: IndexedEntry[];
};

function absoluteOf(scores: ScoreRecord | null): IndexedEntry["absolute"] {
  return scores === null
    ? null
    : {
        total: scores.total,
        max: scores.max,
        overallAesthetic: scores.overallAesthetic,
        axes: scores.axes,
      };
}

export function leaderboardIndex(boards: readonly TaskBoard[]): TaskIndex[] {
  return boards.map((board) => ({
    task: board.task,
    rubric: board.rubric,
    judgedAt: board.tournament?.at ?? null,
    model: board.tournament?.model ?? null,
    entries: sortedEntries(board).map((entry) => ({
      id: entry.meta.id,
      anchor: entry.meta.anchor,
      weak: entry.meta.weak,
      head: entry.meta.head,
      agent: entry.meta.agent,
      rating: ratingOf(board, entry),
      absolute: absoluteOf(boardScore(board, entry)),
      checks: entry.meta.checks,
      lint: entry.meta.lint,
      repetition: entry.meta.repetition,
      seconds: entry.meta.seconds,
      usage: entry.meta.usage,
    })),
  }));
}
