import { useEffect, useMemo, useRef, useState } from "react";
import {
  CompetitionCronSchema,
  computeUpcomingSchedule,
  CronPresets,
  ReportScheduleTimezoneSchema,
} from "@scout-for-lol/data/model/competitions/competition-cron.ts";
import {
  Field,
  FieldDescription,
  FieldError,
  Input,
  Label,
} from "@scout-for-lol/design-system/components/input";
import { TimezoneSelect } from "#src/components/timezone-select.tsx";
import { fieldErrorMessage } from "#src/components/semantic-form.tsx";

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

type ScheduleField = {
  name: string;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
  onBlur?: () => void;
};

type FormStringField = {
  name: string;
  state: {
    value: string;
    meta: { isTouched: boolean; errors: unknown[] };
  };
  handleChange: (value: string) => void;
  handleBlur: () => void;
};

export function scheduleField(field: FormStringField): ScheduleField {
  return {
    name: field.name,
    value: field.state.value,
    error: field.state.meta.isTouched
      ? fieldErrorMessage(field.state.meta.errors)
      : undefined,
    onChange: field.handleChange,
    onBlur: field.handleBlur,
  };
}

export function ReportScheduleFields(props: {
  cron: ScheduleField;
  timezone: ScheduleField;
}) {
  const matchingPreset = CronPresets.find(
    (entry) => entry.value === props.cron.value,
  )?.value;
  const [customSelected, setCustomSelected] = useState(
    () => matchingPreset === undefined,
  );
  const cronInputRef = useRef<HTMLInputElement>(null);
  const presetSelectRef = useRef<HTMLSelectElement>(null);
  const pendingCronFocus = useRef(false);

  useEffect(() => {
    if (customSelected && pendingCronFocus.current) {
      pendingCronFocus.current = false;
      cronInputRef.current?.focus();
    }
  }, [customSelected]);

  useEffect(() => {
    const form = presetSelectRef.current?.form;
    if (form === undefined || form === null) return;
    const resetDisclosure = () => {
      setCustomSelected(false);
      pendingCronFocus.current = false;
    };
    form.addEventListener("reset", resetDisclosure);
    return () => {
      form.removeEventListener("reset", resetDisclosure);
    };
  }, []);

  // Derived, not just state: a report hydrated with a custom cron (edit page)
  // must show the cron input even though the user never clicked "Custom cron".
  const isCustom = customSelected || matchingPreset === undefined;
  const selectValue = isCustom ? CUSTOM_SCHEDULE : matchingPreset;

  const upcoming = useMemo(
    () => schedulePreview(props.cron.value, props.timezone.value),
    [props.cron.value, props.timezone.value],
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <Label htmlFor="report-schedule-preset">Schedule preset</Label>
          <select
            ref={presetSelectRef}
            id="report-schedule-preset"
            name="schedule-preset"
            className="scout-control"
            value={selectValue}
            onChange={(event) => {
              const value = event.currentTarget.value;
              if (value === CUSTOM_SCHEDULE) {
                pendingCronFocus.current = true;
                setCustomSelected(true);
                return;
              }
              setCustomSelected(false);
              props.cron.onChange(value);
            }}
          >
            {CronPresets.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
            <option value={CUSTOM_SCHEDULE}>Custom cron</option>
          </select>
        </Field>
        <Field>
          <Label htmlFor="report-schedule-timezone">Timezone</Label>
          <TimezoneSelect
            id="report-schedule-timezone"
            name={props.timezone.name}
            value={props.timezone.value}
            onChange={props.timezone.onChange}
            required
            ariaInvalid={props.timezone.error !== undefined}
            {...(props.timezone.onBlur === undefined
              ? {}
              : { onBlur: props.timezone.onBlur })}
            {...(props.timezone.error === undefined
              ? {}
              : { ariaDescribedBy: "report-schedule-timezone-error" })}
          />
          {props.timezone.error === undefined ? null : (
            <FieldError id="report-schedule-timezone-error">
              {props.timezone.error}
            </FieldError>
          )}
        </Field>
      </div>
      {isCustom && (
        <Field>
          <Label htmlFor="report-schedule-cron">Cron expression</Label>
          <Input
            ref={cronInputRef}
            id="report-schedule-cron"
            name={props.cron.name}
            className="font-mono"
            value={props.cron.value}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={props.cron.error === undefined ? undefined : true}
            aria-describedby={
              props.cron.error === undefined
                ? "report-schedule-cron-description"
                : "report-schedule-cron-description report-schedule-cron-error"
            }
            onChange={(event) => {
              props.cron.onChange(event.currentTarget.value);
            }}
            onBlur={props.cron.onBlur}
          />
          <FieldDescription id="report-schedule-cron-description">
            Runs at most once per day — exactly one minute and one hour (e.g.{" "}
            <code>30 18 * * 1</code>).
          </FieldDescription>
          {props.cron.error === undefined ? null : (
            <FieldError id="report-schedule-cron-error">
              {props.cron.error}
            </FieldError>
          )}
        </Field>
      )}
      {upcoming.ok ? (
        <output
          className="block space-y-1"
          htmlFor="report-schedule-cron report-schedule-timezone"
        >
          <p className="text-xs font-medium text-scout-subtle">Next 3 runs</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-scout-subtle">
            {upcoming.dates.map((date) => (
              <time
                key={date.toISOString()}
                dateTime={date.toISOString()}
                title={scheduleRunTitle(date, props.timezone.value)}
              >
                {LOCAL_RUN_FORMAT.format(date)}
              </time>
            ))}
          </div>
        </output>
      ) : (
        <FieldError>{upcoming.message}</FieldError>
      )}
    </div>
  );
}

type SchedulePreview =
  { ok: true; dates: Date[] } | { ok: false; message: string };

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
