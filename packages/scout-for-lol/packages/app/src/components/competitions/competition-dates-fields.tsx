import { getAllSeasons } from "@scout-for-lol/data";
import { Input } from "@scout-for-lol/design-system/components/input";
import { Label } from "@scout-for-lol/design-system/components/label";
import {
  BuilderFieldError,
  builderErrorAttributes,
} from "#src/components/builder-field-error.tsx";
import { TimezoneSelect } from "#src/components/timezone-select.tsx";

export type DatesState = {
  mode: "FIXED_DATES" | "SEASON";
  startDate: string;
  endDate: string;
  seasonId: string;
};

// Season boundaries in the catalog (packages/data/src/seasons.ts) are Pacific
// instants (e.g. `2026-07-28T23:59:59-07:00`). Format them in that same zone so
// the advertised calendar dates match the catalog for every viewer — a
// browser-local format renders the July 28 end as July 29 in UTC/Europe and the
// June 10 midnight start as June 9 in Hawaii.
const SEASON_CATALOG_TIME_ZONE = "America/Los_Angeles";

/**
 * Format a season's start/end as a compact date range in the catalog timezone,
 * e.g. "Jun 10 – Jul 28, 2026". Both years are shown when they differ.
 */
function formatDateRange(start: Date, end: Date): string {
  const monthDay = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: SEASON_CATALOG_TIME_ZONE,
  });
  const year = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    timeZone: SEASON_CATALOG_TIME_ZONE,
  });
  const startYear = year.format(start);
  const endYear = year.format(end);
  const startText =
    startYear === endYear
      ? monthDay.format(start)
      : `${monthDay.format(start)}, ${startYear}`;
  return `${startText} – ${monthDay.format(end)}, ${endYear}`;
}

export function CompetitionDatesFields(props: {
  value: DatesState;
  timezone: string;
  disabled?: boolean;
  errors: Record<"startDate" | "endDate" | "seasonId", string | undefined>;
  onChange: (next: DatesState) => void;
  onTimezoneChange: (next: string) => void;
}) {
  const { value, disabled = false, onChange } = props;

  // Compute inside the component body so "now" reflects render time rather
  // than freezing at module load.
  const now = new Date();
  const seasonChoices = getAllSeasons().filter(
    (season) => season.endDate >= now,
  );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="competition-dates-mode">Schedule</Label>
        <select
          className="scout-control"
          id="competition-dates-mode"
          name="dates.mode"
          value={value.mode}
          disabled={disabled}
          onChange={(event) => {
            onChange({
              ...value,
              mode:
                event.currentTarget.value === "SEASON"
                  ? "SEASON"
                  : "FIXED_DATES",
            });
          }}
        >
          <option value="FIXED_DATES">Fixed dates</option>
          <option value="SEASON">League season dates</option>
        </select>
      </div>

      {value.mode === "FIXED_DATES" ? (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="competition-start">Start date</Label>
              <Input
                id="competition-start"
                name="dates.startDate"
                type="date"
                required
                value={value.startDate}
                data-empty={value.startDate === ""}
                disabled={disabled}
                {...builderErrorAttributes(
                  props.errors.startDate,
                  "competition-start-error",
                )}
                onChange={(event) => {
                  onChange({ ...value, startDate: event.target.value });
                }}
              />
              <BuilderFieldError
                id="competition-start-error"
                error={props.errors.startDate}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="competition-end">End date</Label>
              <Input
                id="competition-end"
                name="dates.endDate"
                type="date"
                required
                value={value.endDate}
                data-empty={value.endDate === ""}
                disabled={disabled}
                {...builderErrorAttributes(
                  props.errors.endDate,
                  "competition-end-error",
                )}
                onChange={(event) => {
                  onChange({ ...value, endDate: event.target.value });
                }}
              />
              <BuilderFieldError
                id="competition-end-error"
                error={props.errors.endDate}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="competition-timezone">Competition timezone</Label>
            <TimezoneSelect
              id="competition-timezone"
              name="analysisTimezone"
              value={props.timezone}
              onChange={props.onTimezoneChange}
              required
            />
            <p className="text-xs text-scout-subtle">
              Fixed dates run from the first day at 12:00 AM through the last
              day at 11:59 PM in this timezone.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="competition-season">Season</Label>
          <p className="text-sm text-scout-subtle">
            The season sets only the competition dates. Game version and queue
            choices determine which matches count.
          </p>
          <select
            className="scout-control"
            id="competition-season"
            name="dates.seasonId"
            value={value.seasonId}
            disabled={disabled}
            required
            {...builderErrorAttributes(
              props.errors.seasonId,
              "competition-season-error",
            )}
            onChange={(event) => {
              onChange({ ...value, seasonId: event.currentTarget.value });
            }}
          >
            <option value="" disabled>
              Pick a season
            </option>
            {seasonChoices.map((season) => (
              <option key={season.id} value={season.id}>
                {season.displayName} (
                {formatDateRange(season.startDate, season.endDate)})
              </option>
            ))}
          </select>
          <BuilderFieldError
            id="competition-season-error"
            error={props.errors.seasonId}
          />
        </div>
      )}
    </div>
  );
}
