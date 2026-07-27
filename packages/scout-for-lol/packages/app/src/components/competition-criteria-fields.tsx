import { useState } from "react";
import { match } from "ts-pattern";
import {
  type CompetitionCriteria,
  competitionQueueTypeToString,
  CompetitionQueueTypeSchema,
  isCompetitionQueueCurrentlyAvailable,
} from "@scout-for-lol/data";
import { ChampionCombobox } from "#src/components/champion-combobox.tsx";
import { Input } from "#src/components/ui/input.tsx";
import { Label } from "#src/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#src/components/ui/select.tsx";

export type CriteriaState = {
  criteriaType: CompetitionCriteria["type"];
  queue: string;
  championId: string;
  minGames: string;
};

const CRITERIA_OPTIONS: {
  value: CompetitionCriteria["type"];
  label: string;
}[] = [
  { value: "MOST_GAMES_PLAYED", label: "Most games played" },
  { value: "MOST_WINS_PLAYER", label: "Most wins" },
  { value: "MOST_WINS_CHAMPION", label: "Most wins on a champion" },
  { value: "HIGHEST_WIN_RATE", label: "Highest win rate" },
  { value: "HIGHEST_RANK", label: "Highest rank" },
  { value: "MOST_RANK_CLIMB", label: "Most rank climb (LP)" },
];

const ALL_QUEUES = CompetitionQueueTypeSchema.options;
const RANKED_QUEUES = ["SOLO", "FLEX"] as const;

function isAvailableChoice(queue: string): boolean {
  return isCompetitionQueueCurrentlyAvailable(
    CompetitionQueueTypeSchema.parse(queue),
  );
}

function QueueSelect(props: {
  id: string;
  value: string;
  options: readonly string[];
  disabled?: boolean;
  includeAny?: boolean;
  onChange: (next: string) => void;
}) {
  // Limited-time queues that are not currently live are hidden until the
  // checkbox reveals them; the current value always stays visible (editing
  // an old competition must keep its queue selectable).
  const [showUnavailable, setShowUnavailable] = useState(false);
  const unavailableCount = props.options.filter(
    (queue) => queue !== props.value && !isAvailableChoice(queue),
  ).length;
  const visibleOptions = props.options.filter(
    (queue) =>
      showUnavailable || queue === props.value || isAvailableChoice(queue),
  );

  return (
    <div className="space-y-1.5">
      <Select
        value={props.value}
        disabled={props.disabled ?? false}
        onValueChange={props.onChange}
      >
        <SelectTrigger id={props.id}>
          <SelectValue placeholder="Pick a queue" />
        </SelectTrigger>
        <SelectContent>
          {props.includeAny === true && (
            <SelectItem value="__ANY__">Any queue</SelectItem>
          )}
          {visibleOptions.map((queue) => (
            <SelectItem key={queue} value={queue}>
              <span
                className={
                  isAvailableChoice(queue) ? undefined : "text-muted-foreground"
                }
              >
                {competitionQueueTypeToString(
                  CompetitionQueueTypeSchema.parse(queue),
                )}
                {isAvailableChoice(queue) ? "" : " (not currently live)"}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {/* Rendered outside the Select: Radix moves focus among its SelectItem
          collection and blocks Tab within the open listbox, so a checkbox
          inside SelectContent is unreachable by keyboard. Placing it in normal
          flow keeps it Tab-focusable. */}
      {unavailableCount > 0 && (
        <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={showUnavailable}
            disabled={props.disabled ?? false}
            onChange={(event) => {
              setShowUnavailable(event.target.checked);
            }}
          />
          Show unavailable queues ({unavailableCount})
        </label>
      )}
    </div>
  );
}

export function CompetitionCriteriaFields(props: {
  value: CriteriaState;
  disabled?: boolean;
  onChange: (next: CriteriaState) => void;
}) {
  const { value, disabled = false, onChange } = props;

  const fields = match(value.criteriaType)
    .with("HIGHEST_RANK", "MOST_RANK_CLIMB", () => (
      <div className="space-y-2">
        <Label htmlFor="criteria-queue">Queue</Label>
        <QueueSelect
          id="criteria-queue"
          value={value.queue}
          options={RANKED_QUEUES}
          disabled={disabled}
          onChange={(next) => {
            onChange({ ...value, queue: next });
          }}
        />
      </div>
    ))
    .with("MOST_GAMES_PLAYED", "MOST_WINS_PLAYER", () => (
      <div className="space-y-2">
        <Label htmlFor="criteria-queue">Queue</Label>
        <QueueSelect
          id="criteria-queue"
          value={value.queue}
          options={ALL_QUEUES}
          disabled={disabled}
          onChange={(next) => {
            onChange({ ...value, queue: next });
          }}
        />
      </div>
    ))
    .with("MOST_WINS_CHAMPION", () => (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="criteria-champion">Champion</Label>
          <ChampionCombobox
            id="criteria-champion"
            value={value.championId}
            disabled={disabled}
            onChange={(championId) => {
              onChange({ ...value, championId });
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="criteria-queue">Queue (optional)</Label>
          <QueueSelect
            id="criteria-queue"
            value={value.queue}
            options={ALL_QUEUES}
            disabled={disabled}
            includeAny
            onChange={(next) => {
              onChange({ ...value, queue: next });
            }}
          />
        </div>
      </div>
    ))
    .with("HIGHEST_WIN_RATE", () => (
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="criteria-min-games">Minimum games</Label>
          <Input
            id="criteria-min-games"
            type="number"
            min={1}
            value={value.minGames}
            disabled={disabled}
            onChange={(event) => {
              onChange({ ...value, minGames: event.target.value });
            }}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="criteria-queue">Queue</Label>
          <QueueSelect
            id="criteria-queue"
            value={value.queue}
            options={ALL_QUEUES}
            disabled={disabled}
            onChange={(next) => {
              onChange({ ...value, queue: next });
            }}
          />
        </div>
      </div>
    ))
    .exhaustive();

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="criteria-type">Criteria</Label>
        <Select
          value={value.criteriaType}
          disabled={disabled}
          onValueChange={(next) => {
            onChange({
              ...value,
              criteriaType: CRITERIA_OPTIONS.some((o) => o.value === next)
                ? CompetitionCriteriaTypeFromString(next)
                : value.criteriaType,
            });
          }}
        >
          <SelectTrigger id="criteria-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CRITERIA_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {fields}
    </div>
  );
}

function CompetitionCriteriaTypeFromString(
  value: string,
): CompetitionCriteria["type"] {
  return match(value)
    .with("MOST_GAMES_PLAYED", () => "MOST_GAMES_PLAYED" as const)
    .with("MOST_WINS_PLAYER", () => "MOST_WINS_PLAYER" as const)
    .with("MOST_WINS_CHAMPION", () => "MOST_WINS_CHAMPION" as const)
    .with("HIGHEST_WIN_RATE", () => "HIGHEST_WIN_RATE" as const)
    .with("HIGHEST_RANK", () => "HIGHEST_RANK" as const)
    .with("MOST_RANK_CLIMB", () => "MOST_RANK_CLIMB" as const)
    .otherwise(() => "MOST_GAMES_PLAYED" as const);
}
