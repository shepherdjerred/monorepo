import { useMemo } from "react";
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

const CUSTOM_SCHEDULE = "custom";
const TIMEZONES = [
  "UTC",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Australia/Sydney",
];

export function ReportScheduleFields(props: {
  cronExpression: string;
  scheduleTimezone: string;
  onCronChange: (value: string) => void;
  onTimezoneChange: (value: string) => void;
}) {
  const preset =
    CronPresets.find((entry) => entry.value === props.cronExpression)?.value ??
    CUSTOM_SCHEDULE;
  const upcoming = useMemo(
    () => schedulePreview(props.cronExpression, props.scheduleTimezone),
    [props.cronExpression, props.scheduleTimezone],
  );

  return (
    <div className="space-y-3">
      <Label>Schedule</Label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          value={preset}
          onValueChange={(value) => {
            if (value !== CUSTOM_SCHEDULE) {
              props.onCronChange(value);
            }
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
        <Select
          value={props.scheduleTimezone}
          onValueChange={props.onTimezoneChange}
        >
          <SelectTrigger aria-label="Schedule timezone">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TIMEZONES.map((timezone) => (
              <SelectItem key={timezone} value={timezone}>
                {timezone.replaceAll("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Input
        aria-label="Cron expression"
        className="font-mono"
        value={props.cronExpression}
        onChange={(event) => {
          props.onCronChange(event.target.value);
        }}
      />
      {upcoming.ok ? (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {upcoming.dates.map((date) => (
            <span key={date.toISOString()}>
              {date.toLocaleString(undefined, {
                timeZone: props.scheduleTimezone,
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          ))}
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
