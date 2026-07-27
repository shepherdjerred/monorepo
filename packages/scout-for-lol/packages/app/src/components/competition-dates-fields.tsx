import { getAllSeasons } from "@scout-for-lol/data";
import { Input } from "#src/components/ui/input.tsx";
import { Label } from "#src/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#src/components/ui/select.tsx";

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
  disabled?: boolean;
  onChange: (next: DatesState) => void;
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
        <Select
          value={value.mode}
          disabled={disabled}
          onValueChange={(next) => {
            onChange({
              ...value,
              mode: next === "SEASON" ? "SEASON" : "FIXED_DATES",
            });
          }}
        >
          <SelectTrigger id="competition-dates-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="FIXED_DATES">Fixed dates</SelectItem>
            <SelectItem value="SEASON">League season</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {value.mode === "FIXED_DATES" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="competition-start">Start date</Label>
            <Input
              id="competition-start"
              type="date"
              value={value.startDate}
              disabled={disabled}
              onChange={(event) => {
                onChange({ ...value, startDate: event.target.value });
              }}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="competition-end">End date</Label>
            <Input
              id="competition-end"
              type="date"
              value={value.endDate}
              disabled={disabled}
              onChange={(event) => {
                onChange({ ...value, endDate: event.target.value });
              }}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="competition-season">Season</Label>
          <Select
            value={value.seasonId}
            disabled={disabled}
            onValueChange={(next) => {
              onChange({ ...value, seasonId: next });
            }}
          >
            <SelectTrigger id="competition-season">
              <SelectValue placeholder="Pick a season" />
            </SelectTrigger>
            <SelectContent>
              {seasonChoices.map((season) => (
                <SelectItem key={season.id} value={season.id}>
                  <span className="flex flex-col">
                    <span>{season.displayName}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateRange(season.startDate, season.endDate)}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
