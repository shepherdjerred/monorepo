import { Loaded } from "@shepherdjerred/loaded";
import type { DareProgress, DareProgressCondition } from "@scout-for-lol/data";
import { z } from "zod";
import {
  ErrorState,
  StaleState,
} from "@scout-for-lol/design-system/domain/states";
import { DelayedLoadingState } from "#src/components/chrome/section-skeleton.tsx";
import { EmptyState } from "@scout-for-lol/design-system/layout";
import { DareStatePill as StatePill } from "#src/components/bucks/bucks-dare-display.tsx";

export type DareSummary = {
  id: number;
  state: string;
  originalText: string;
  displayTitle: string | null;
  statusPhrases: Readonly<Record<string, string>> | null;
  targetAliases: string[];
  potTotal: number;
  updatedAt: string;
  progress: DareProgress;
  requiresViewerAction: boolean;
};

const OPENING_STAKE_SUFFIX = /\s*Opening stake: \d+ BB\.?\s*$/u;
const GENERIC_GAME_SETS = new Set([
  "games",
  "game",
  "qualifying_game",
  "qualifying_games",
]);

const CountableValuesSchema = z.strictObject({
  current: z.number(),
  target: z.number(),
});
const RankValuesSchema = z.strictObject({
  current: z.string().min(1),
  target: z.string().min(1),
});
const PendingImprovementSchema = z.strictObject({
  current: z.null(),
  target: z.number(),
});
const UnmatchedCurrentSchema = z.strictObject({
  current: z.number(),
  target: z.null(),
});

export function dareDisplayTitle(originalText: string): string {
  const title = originalText.replace(OPENING_STAKE_SUFFIX, "").trim();
  return title.length > 0 ? title : originalText;
}

export function dareListTitle(dare: {
  displayTitle: string | null;
  originalText: string;
}): string {
  return dare.displayTitle ?? dareDisplayTitle(dare.originalText);
}

function gamesLabel(count: number): string {
  return count === 1 ? "game" : "games";
}

function humanizeSlug(value: string): string {
  return value.replaceAll("_", " ").trim();
}

function formatStatusNumber(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(1);
}

function authoredPhrase(
  gameSet: string | null,
  phrases: Readonly<Record<string, string>> | null,
): string | undefined {
  if (phrases === null) return undefined;
  if (gameSet === null) return undefined;
  return phrases[gameSet];
}

function improvementUnit(
  condition: DareProgressCondition,
  phrases: Readonly<Record<string, string>> | null,
): string {
  const authored = authoredPhrase(condition.gameSet, phrases);
  if (authored !== undefined) return authored;
  const source = condition.gameSet ?? condition.label;
  if (source.includes("cs_per_minute") || source.includes("cs_per_min")) {
    return "CS/min";
  }
  if (condition.gameSet !== null && !GENERIC_GAME_SETS.has(condition.gameSet)) {
    return humanizeSlug(condition.gameSet);
  }
  return humanizeSlug(source);
}

function conditionPhrase(
  gameSet: string | null,
  target: number,
  phrases: Readonly<Record<string, string>> | null,
): string {
  const authored = authoredPhrase(gameSet, phrases);
  if (authored !== undefined) return authored;
  if (gameSet !== null && !GENERIC_GAME_SETS.has(gameSet)) {
    return humanizeSlug(gameSet);
  }
  return gamesLabel(target);
}

function countableLine(
  current: number,
  target: number,
  phrase: string,
): string {
  return `${current.toString()} of ${target.toString()} ${phrase}`;
}

function progressValues(condition: DareProgressCondition): {
  current: DareProgressCondition["current"];
  target: DareProgressCondition["target"];
} {
  return { current: condition.current, target: condition.target };
}

function improvementStatusLine(
  condition: DareProgressCondition,
  phrases: Readonly<Record<string, string>> | null,
): string | null {
  if (condition.kind !== "personal_improvement") return null;
  const unit = improvementUnit(condition, phrases);
  const countable = CountableValuesSchema.safeParse(progressValues(condition));
  if (countable.success) {
    return `Best ${formatStatusNumber(countable.data.current)} ${unit}, needs ${formatStatusNumber(countable.data.target)}`;
  }
  const pending = PendingImprovementSchema.safeParse(progressValues(condition));
  if (pending.success) {
    return `Needs ${formatStatusNumber(pending.data.target)} ${unit}`;
  }
  return null;
}

function rankStatusLine(condition: DareProgressCondition): string | null {
  const parsed = RankValuesSchema.safeParse(progressValues(condition));
  if (!parsed.success) return null;
  return `${parsed.data.current}, needs ${parsed.data.target}`;
}

function countableStatusLine(
  condition: DareProgressCondition,
  phrases: Readonly<Record<string, string>> | null,
): string | null {
  const parsed = CountableValuesSchema.safeParse(progressValues(condition));
  if (!parsed.success) return null;
  return countableLine(
    parsed.data.current,
    parsed.data.target,
    conditionPhrase(condition.gameSet, parsed.data.target, phrases),
  );
}

function unmatchedCurrentLine(
  condition: DareProgressCondition,
  phrases: Readonly<Record<string, string>> | null,
): string | null {
  const parsed = UnmatchedCurrentSchema.safeParse(progressValues(condition));
  if (!parsed.success) return null;
  const authored = authoredPhrase(condition.gameSet, phrases);
  if (authored !== undefined) {
    return `${parsed.data.current.toString()} ${authored}`;
  }
  if (parsed.data.current === 0) return "Waiting for a game";
  return `${parsed.data.current.toString()} ${gamesLabel(parsed.data.current)} so far`;
}

function conditionStatusLine(
  condition: DareProgressCondition,
  phrases: Readonly<Record<string, string>> | null,
): string | null {
  return (
    improvementStatusLine(condition, phrases) ??
    rankStatusLine(condition) ??
    countableStatusLine(condition, phrases) ??
    unmatchedCurrentLine(condition, phrases)
  );
}

function terminalOutcome(progress: DareProgress, state: string): string {
  if (progress.value === true) return "Achieved";
  if (state === "cancelled") return "Cancelled";
  if (state === "expired") return "Expired";
  if (state === "declined") return "Declined";
  if (state === "voided") return "Voided";
  return "Not achieved";
}

function liveConditionLines(
  progress: DareProgress,
  statusPhrases: Readonly<Record<string, string>> | null,
): { key: string; text: string }[] {
  const lines: { key: string; text: string }[] = [];
  for (const condition of progress.conditions) {
    const text = conditionStatusLine(condition, statusPhrases);
    if (text !== null) lines.push({ key: condition.key, text });
  }
  return lines;
}

function unmatchedProgressLines(
  progress: DareProgress,
): { key: string; text: string }[] {
  if (progress.matchedGames === 0) {
    return [{ key: "waiting", text: "Waiting for a game" }];
  }
  return [
    {
      key: "matched",
      text: `${progress.matchedGames.toString()} ${gamesLabel(progress.matchedGames)} so far`,
    },
  ];
}

export function dareListStatusLines(
  progress: DareProgress,
  state: string,
  statusPhrases: Readonly<Record<string, string>> | null = null,
): { key: string; text: string }[] {
  if (progress.final) {
    return [{ key: "outcome", text: terminalOutcome(progress, state) }];
  }
  if (progress.value === true) {
    return [{ key: "outcome", text: "Complete, waiting to settle" }];
  }
  const lines = liveConditionLines(progress, statusPhrases);
  if (lines.length > 0) return lines;
  return unmatchedProgressLines(progress);
}

/**
 * `loading` and `error` used to arrive as separate props alongside `dares`,
 * so "failed" and "we already have a page" could both be true and the
 * component resolved it by discarding the page. One state cannot say both.
 */
export function DareList(props: {
  dares: Loaded<readonly DareSummary[]>;
  onRetry: () => void;
  onSelect: (dareId: number) => void;
}) {
  return Loaded.match(props.dares, {
    loading: () => <DelayedLoadingState label="Loading dares…" />,
    error: (errors) => (
      <ErrorState
        message={Loaded.messageOf(errors[0].error)}
        onRetry={props.onRetry}
      />
    ),
    available: (dares, meta) =>
      dares.length === 0 ? (
        <>
          {/*
            An empty list can itself be stale — a cached `[]` whose refetch
            failed. Without the notice the reader is told there are no matching
            dares with nothing to say the answer is out of date, which is the
            most misleading of the four states.
          */}
          <StaleState errors={meta.errors} />
          <EmptyState>
            <h2>No dares match</h2>
            <p>Try another search or create a Dare in Explore.</p>
          </EmptyState>
        </>
      ) : (
        <>
          <StaleState errors={meta.errors} />
          <ul className="grid gap-3 lg:grid-cols-2">
            {dares.map((dare) => (
              <li key={dare.id}>
                <button
                  type="button"
                  className="h-full w-full space-y-3 rounded-lg border border-scout-border p-4 text-left hover:bg-scout-hover"
                  onClick={() => {
                    props.onSelect(dare.id);
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-3 text-sm font-medium">
                      {dareListTitle(dare)}
                    </p>
                    <StatePill state={dare.state} />
                  </div>
                  <p className="text-xs text-scout-subtle">
                    {dare.targetAliases.join(", ")} · {dare.potTotal.toString()}{" "}
                    BB
                  </p>
                  <div className="flex items-start justify-between gap-2 text-xs">
                    <div className="space-y-1 text-scout-subtle">
                      {dareListStatusLines(
                        dare.progress,
                        dare.state,
                        dare.statusPhrases,
                      ).map((line) => (
                        <p key={line.key}>{line.text}</p>
                      ))}
                    </div>
                    {dare.requiresViewerAction && (
                      <span className="rounded-full bg-scout-warning/15 px-2 py-0.5 text-scout-warning">
                        Needs action
                      </span>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      ),
  });
}
