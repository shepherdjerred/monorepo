import { match } from "ts-pattern";
import {
  type CompetitionCriteria,
  competitionQueueTypeToString,
  CompetitionQueueTypeSchema,
} from "@scout-for-lol/data";
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

function QueueSelect(props: {
  id: string;
  value: string;
  options: readonly string[];
  disabled?: boolean;
  includeAny?: boolean;
  onChange: (next: string) => void;
}) {
  return (
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
        {props.options.map((queue) => (
          <SelectItem key={queue} value={queue}>
            {competitionQueueTypeToString(
              CompetitionQueueTypeSchema.parse(queue),
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
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
          <Label htmlFor="criteria-champion">Champion ID</Label>
          <Input
            id="criteria-champion"
            type="number"
            min={1}
            value={value.championId}
            disabled={disabled}
            onChange={(event) => {
              onChange({ ...value, championId: event.target.value });
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
