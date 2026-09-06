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
  BuilderFieldError,
  builderErrorAttributes,
} from "#src/components/builder-field-error.tsx";

export type CriteriaState = {
  criteriaType: CompetitionCriteria["type"];
  queues: CompetitionQueueType[];
  aggregation: RankAggregation;
  championId: string;
  minGames: string;
};

export const COMPETITION_CRITERIA_OPTIONS: readonly {
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

export const RANKED_COMPETITION_QUEUES = ["solo", "flex", "ranked 5s"] as const;

export function isRankCriterion(type: CompetitionCriteria["type"]): boolean {
  return type === "HIGHEST_RANK" || type === "MOST_RANK_CLIMB";
}

export function criteriaForGameVariant(
  value: CriteriaState,
  gameVariant: CompetitionGameVariant,
): CriteriaState {
  const compatibleQueues = value.queues.filter(
    (queue) => queue === "ALL" || queueMatchesGameVariant(queue, gameVariant),
  );
  const queues: CompetitionQueueType[] =
    compatibleQueues.length === 0 ? ["ALL"] : compatibleQueues;
  return gameVariant === "CLASSIC" && isRankCriterion(value.criteriaType)
    ? { ...value, criteriaType: "MOST_GAMES_PLAYED", queues }
    : { ...value, queues };
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
  error: string | undefined;
  onChange: (next: CompetitionQueueType[]) => void;
}) {
  return (
    <div className="space-y-2">
      <fieldset
        className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-2"
        disabled={props.disabled ?? false}
        {...builderErrorAttributes(props.error, "criteria-queues-error")}
        tabIndex={props.error === undefined ? undefined : -1}
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
                name="criteria.queues"
                value={queue}
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
      <BuilderFieldError id="criteria-queues-error" error={props.error} />
    </div>
  );
}

export function CompetitionCriteriaFields(props: {
  value: CriteriaState;
  gameVariant: CompetitionGameVariant;
  disabled?: boolean;
  errors: Record<
    | "gameVariant"
    | "criteriaType"
    | "queues"
    | "aggregation"
    | "championId"
    | "minGames",
    string | undefined
  >;
  onChange: (next: CriteriaState) => void;
  onGameVariantChange: (next: CompetitionGameVariant) => void;
}) {
  const { value, disabled = false, onChange } = props;
  const ranked = isRankCriterion(value.criteriaType);
  const queueOptions: readonly CompetitionQueueType[] = ranked
    ? RANKED_COMPETITION_QUEUES
    : queueOptionsForVariant(props.gameVariant);

  const fields = match(value.criteriaType)
    .with("HIGHEST_RANK", "MOST_RANK_CLIMB", () => (
      <div className="space-y-3">
        <QueueMultiselect
          value={value.queues}
          options={queueOptions}
          disabled={disabled}
          error={props.errors.queues}
          onChange={(queues) => {
            onChange({ ...value, queues });
          }}
        />
        {value.queues.length > 1 && (
          <div className="space-y-2">
            <Label htmlFor="criteria-aggregation">Rank scoring</Label>
            <select
              className="scout-control"
              id="criteria-aggregation"
              name="criteria.aggregation"
              value={value.aggregation}
              disabled={disabled}
              required
              {...builderErrorAttributes(
                props.errors.aggregation,
                "criteria-aggregation-error",
              )}
              onChange={(event) => {
                const aggregation = event.currentTarget.value;
                if (aggregation === "MAX" || aggregation === "SUM") {
                  onChange({ ...value, aggregation });
                }
              }}
            >
              <option value="MAX">Best selected rank</option>
              <option value="SUM">Combined ranks</option>
            </select>
            <BuilderFieldError
              id="criteria-aggregation-error"
              error={props.errors.aggregation}
            />
          </div>
        )}
      </div>
    ))
    .with("MOST_GAMES_PLAYED", "MOST_WINS_PLAYER", () => (
      <QueueMultiselect
        value={value.queues}
        options={queueOptions}
        disabled={disabled}
        error={props.errors.queues}
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
            name="criteria.championId"
            value={value.championId}
            gameVariant={props.gameVariant}
            disabled={disabled}
            required
            {...(props.errors.championId === undefined
              ? {}
              : {
                  ariaInvalid: true,
                  ariaDescribedBy: "criteria-champion-error",
                })}
            onChange={(championId) => {
              onChange({ ...value, championId });
            }}
          />
          <BuilderFieldError
            id="criteria-champion-error"
            error={props.errors.championId}
          />
        </div>
        <QueueMultiselect
          value={value.queues}
          options={queueOptions}
          disabled={disabled}
          error={props.errors.queues}
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
            name="criteria.minGames"
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            required
            value={value.minGames}
            disabled={disabled}
            {...builderErrorAttributes(
              props.errors.minGames,
              "criteria-min-games-error",
            )}
            onChange={(event) => {
              onChange({ ...value, minGames: event.target.value });
            }}
          />
          <BuilderFieldError
            id="criteria-min-games-error"
            error={props.errors.minGames}
          />
        </div>
        <QueueMultiselect
          value={value.queues}
          options={queueOptions}
          disabled={disabled}
          error={props.errors.queues}
          onChange={(queues) => {
            onChange({ ...value, queues });
          }}
        />
      </div>
    ))
    .exhaustive();

  const criteriaOptions =
    props.gameVariant === "CLASSIC"
      ? COMPETITION_CRITERIA_OPTIONS.filter(
          (option) => !isRankCriterion(option.value),
        )
      : COMPETITION_CRITERIA_OPTIONS;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="competition-game-variant">Game version</Label>
        <select
          className="scout-control"
          id="competition-game-variant"
          name="gameVariant"
          value={props.gameVariant}
          disabled={disabled}
          required
          {...builderErrorAttributes(
            props.errors.gameVariant,
            "competition-game-variant-error",
          )}
          onChange={(event) => {
            const next = event.currentTarget.value;
            if (next === "MODERN" || next === "CLASSIC") {
              onChange(criteriaForGameVariant(value, next));
              props.onGameVariantChange(next);
            }
          }}
        >
          <option value="MODERN">Modern League</option>
          <option value="CLASSIC">League Classic</option>
        </select>
        <BuilderFieldError
          id="competition-game-variant-error"
          error={props.errors.gameVariant}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="criteria-type">Criteria</Label>
        <select
          className="scout-control"
          id="criteria-type"
          name="criteria.criteriaType"
          value={value.criteriaType}
          disabled={disabled}
          required
          {...builderErrorAttributes(
            props.errors.criteriaType,
            "criteria-type-error",
          )}
          onChange={(event) => {
            const next = event.currentTarget.value;
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
          {criteriaOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <BuilderFieldError
          id="criteria-type-error"
          error={props.errors.criteriaType}
        />
      </div>
      {fields}
      <p className="text-xs text-scout-subtle">
        Season selection controls the date window. Game version and queues
        control which matches count.
      </p>
    </div>
  );
}
