import { useEffect, useMemo, useRef, useState } from "react";
import {
  CompetitionCronSchema,
  computeUpcomingSchedule,
  CronPresets,
  ReportScheduleTimezoneSchema,
} from "@scout-for-lol/data/model/competition-cron.ts";
import { Input } from "#src/components/ui/input.tsx";
import { Label } from "#src/components/ui/label.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#src/components/ui/select.tsx";
import { TimezoneSelect } from "#src/components/timezone-select.tsx";

const CUSTOM_SCHEDULE = "custom";

// Upcoming runs render in the viewer's local zone with an abbreviation so the
// wall-clock time is unambiguous. dateStyle/timeStyle cannot combine with
// timeZoneName (TypeError), so the components are listed explicitly.
const LOCAL_RUN_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

function scheduleRunTitle(date: Date, timezone: string): string {
  const inScheduleTz = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: timezone,
  }).format(date);
  return `${inScheduleTz} (schedule time)`;
}

export function ReportScheduleFields(props: {
  cronExpression: string;
  scheduleTimezone: string;
  onCronChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
}) {
  const matchingPreset = CronPresets.find(
    (entry) => entry.value === props.cronExpression,
  )?.value;
  const [customSelected, setCustomSelected] = useState(
    () => matchingPreset === undefined,
  );
  const cronInputRef = useRef<HTMLInputElement>(null);
  const pendingCronFocus = useRef(false);

  useEffect(() => {
    if (customSelected && pendingCronFocus.current) {
      pendingCronFocus.current = false;
      cronInputRef.current?.focus();
    }
  }, [customSelected]);

  const selectValue = customSelected
    ? CUSTOM_SCHEDULE
    : (matchingPreset ?? CUSTOM_SCHEDULE);

  const upcoming = useMemo(
    () => schedulePreview(props.cronExpression, props.scheduleTimezone),
    [props.cronExpression, props.scheduleTimezone],
  );

  return (
    <div className="space-y-3">
      <Label>Schedule</Label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          value={selectValue}
          onValueChange={(value) => {
            if (value === CUSTOM_SCHEDULE) {
              pendingCronFocus.current = true;
              setCustomSelected(true);
              return;
            }
            setCustomSelected(false);
            props.onCronChange(value);
          }}
        >
          <SelectTrigger aria-label="Schedule preset">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CronPresets.map((entry) => (
              <SelectItem key={entry.value} value={entry.value}>
                {entry.label}
              </SelectItem>
            ))}
            <SelectItem value={CUSTOM_SCHEDULE}>Custom cron</SelectItem>
          </SelectContent>
        </Select>
        <TimezoneSelect
          id="report-schedule-timezone"
          value={props.scheduleTimezone}
          onChange={props.onTimezoneChange}
        />
      </div>
      {customSelected && (
        <div className="space-y-1">
          <Input
            ref={cronInputRef}
            aria-label="Cron expression"
            className="font-mono"
            value={props.cronExpression}
            onChange={(event) => {
              props.onCronChange(event.target.value);
            }}
          />
          <p className="text-xs text-muted-foreground">
            Runs at most once per day — exactly one minute and one hour (e.g.{" "}
            <code>30 18 * * 1</code>).
          </p>
        </div>
      )}
      {upcoming.ok ? (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            Next 3 runs
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {upcoming.dates.map((date) => (
              <span
                key={date.toISOString()}
                title={scheduleRunTitle(date, props.scheduleTimezone)}
              >
                {LOCAL_RUN_FORMAT.format(date)}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-destructive">{upcoming.message}</p>
      )}
    </div>
  );
}

type SchedulePreview =
  | { ok: true; dates: Date[] }
  | { ok: false; message: string };

function schedulePreview(cron: string, timezone: string): SchedulePreview {
  const cronResult = CompetitionCronSchema.safeParse(cron);
  if (!cronResult.success) {
    return { ok: false, message: cronResult.error.issues[0]?.message ?? "" };
  }
  const timezoneResult = ReportScheduleTimezoneSchema.safeParse(timezone);
  if (!timezoneResult.success) {
    return {
      ok: false,
      message: timezoneResult.error.issues[0]?.message ?? "",
    };
  }
  return {
    ok: true,
    dates: computeUpcomingSchedule(
      cronResult.data,
      new Date(),
      timezoneResult.data,
    ),
  };
}
