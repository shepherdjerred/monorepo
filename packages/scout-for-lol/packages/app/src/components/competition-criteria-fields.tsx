import { match } from "ts-pattern";
import {
  type CompetitionCriteria,
  type CompetitionGameVariant,
  type CompetitionQueueType,
  type RankAggregation,
  QueueTypeSchema,
  competitionQueueTypeToString,
  isCompetitionQueueCurrentlyAvailable,
  queueMatchesGameVariant,
} from "@scout-for-lol/data";
import { ChampionCombobox } from "#src/components/champion-combobox.tsx";
import { Input } from "@scout-for-lol/design-system/components/input";
import { Label } from "@scout-for-lol/design-system/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@scout-for-lol/design-system/components/select";

export type CriteriaState = {
  criteriaType: CompetitionCriteria["type"];
  queues: CompetitionQueueType[];
  aggregation: RankAggregation;
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

const RANKED_QUEUES = ["solo", "flex", "ranked 5s"] as const;

function isRankCriterion(type: CompetitionCriteria["type"]): boolean {
  return type === "HIGHEST_RANK" || type === "MOST_RANK_CLIMB";
}

export function queueOptionsForVariant(
  gameVariant: CompetitionGameVariant,
): CompetitionQueueType[] {
  return [
    "ALL",
    ...QueueTypeSchema.options.filter((queue) =>
      queueMatchesGameVariant(queue, gameVariant),
    ),
  ];
}

function QueueMultiselect(props: {
  value: CompetitionQueueType[];
  options: readonly CompetitionQueueType[];
  disabled?: boolean;
  onChange: (next: CompetitionQueueType[]) => void;
}) {
  return (
    <fieldset
      className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
      disabled={props.disabled ?? false}
    >
      <legend className="px-1 text-sm font-medium text-scout-ink">
        Queues
      </legend>
      {props.options.map((queue) => {
        const checked = props.value.includes(queue);
        const available = isCompetitionQueueCurrentlyAvailable(queue);
        return (
          <label
            key={queue}
            className="flex min-h-11 cursor-pointer items-start gap-2 rounded-md px-2 py-2 hover:bg-scout-hover"
          >
            <input
              type="checkbox"
              className="mt-0.5 size-5 shrink-0"
              checked={checked}
              onChange={(event) => {
                if (event.target.checked) {
                  props.onChange(
                    queue === "ALL"
                      ? ["ALL"]
                      : [
                          ...props.value.filter((entry) => entry !== "ALL"),
                          queue,
                        ],
                  );
                  return;
                }
                const next = props.value.filter((entry) => entry !== queue);
                if (next.length > 0) {
                  props.onChange(next);
                }
              }}
            />
            <span className="flex flex-col text-sm text-scout-ink">
              <span>{competitionQueueTypeToString(queue)}</span>
              {!available && (
                <span className="text-xs text-scout-subtle">
                  Limited-time mode — not currently live
                </span>
              )}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function CompetitionCriteriaFields(props: {
  value: CriteriaState;
  gameVariant: CompetitionGameVariant;
  disabled?: boolean;
  onChange: (next: CriteriaState) => void;
  onGameVariantChange: (next: CompetitionGameVariant) => void;
}) {
  const { value, disabled = false, onChange } = props;
  const ranked = isRankCriterion(value.criteriaType);
  const queueOptions: readonly CompetitionQueueType[] = ranked
    ? RANKED_QUEUES
    : queueOptionsForVariant(props.gameVariant);

  const fields = match(value.criteriaType)
    .with("HIGHEST_RANK", "MOST_RANK_CLIMB", () => (
      <div className="space-y-3">
        <QueueMultiselect
          value={value.queues}
          options={queueOptions}
          disabled={disabled}
          onChange={(queues) => {
            onChange({ ...value, queues });
          }}
        />
        {value.queues.length > 1 && (
          <div className="space-y-2">
            <Label htmlFor="criteria-aggregation">Rank scoring</Label>
            <Select
              value={value.aggregation}
              disabled={disabled}
              onValueChange={(aggregation) => {
                if (aggregation === "MAX" || aggregation === "SUM") {
                  onChange({ ...value, aggregation });
                }
              }}
            >
              <SelectTrigger id="criteria-aggregation">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MAX">Best selected rank</SelectItem>
                <SelectItem value="SUM">Combined ranks</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    ))
    .with("MOST_GAMES_PLAYED", "MOST_WINS_PLAYER", () => (
      <QueueMultiselect
        value={value.queues}
        options={queueOptions}
        disabled={disabled}
        onChange={(queues) => {
          onChange({ ...value, queues });
        }}
      />
    ))
    .with("MOST_WINS_CHAMPION", () => (
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="criteria-champion">Champion</Label>
          <ChampionCombobox
            id="criteria-champion"
            value={value.championId}
            gameVariant={props.gameVariant}
            disabled={disabled}
            onChange={(championId) => {
              onChange({ ...value, championId });
            }}
          />
        </div>
        <QueueMultiselect
          value={value.queues}
          options={queueOptions}
          disabled={disabled}
          onChange={(queues) => {
            onChange({ ...value, queues });
          }}
        />
      </div>
    ))
    .with("HIGHEST_WIN_RATE", () => (
      <div className="space-y-3">
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
        <QueueMultiselect
          value={value.queues}
          options={queueOptions}
          disabled={disabled}
          onChange={(queues) => {
            onChange({ ...value, queues });
          }}
        />
      </div>
    ))
    .exhaustive();

  const criteriaOptions =
    props.gameVariant === "CLASSIC"
      ? CRITERIA_OPTIONS.filter((option) => !isRankCriterion(option.value))
      : CRITERIA_OPTIONS;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="competition-game-variant">Game version</Label>
        <Select
          value={props.gameVariant}
          disabled={disabled}
          onValueChange={(next) => {
            if (next === "MODERN" || next === "CLASSIC") {
              props.onGameVariantChange(next);
            }
          }}
        >
          <SelectTrigger id="competition-game-variant">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="MODERN">Modern League</SelectItem>
            <SelectItem value="CLASSIC">League Classic</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="criteria-type">Criteria</Label>
        <Select
          value={value.criteriaType}
          disabled={disabled}
          onValueChange={(next) => {
            const option = criteriaOptions.find(
              (entry) => entry.value === next,
            );
            if (option === undefined) return;
            onChange({
              ...value,
              criteriaType: option.value,
              queues: isRankCriterion(option.value) ? ["solo"] : value.queues,
            });
          }}
        >
          <SelectTrigger id="criteria-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {criteriaOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {fields}
      <p className="text-xs text-scout-subtle">
        Season selection controls the date window. Game version and queues
        control which matches count.
      </p>
    </div>
  );
}
