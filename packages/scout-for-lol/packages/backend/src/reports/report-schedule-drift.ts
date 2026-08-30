import {
  ScheduleOverlapPolicy,
  type ScheduleDescription,
} from "@temporalio/client";
import { CronExpressionParser } from "cron-parser";
import { z } from "zod";
import {
  SCOUT_WORKFLOW_NAMES,
  ScoutScheduleOwnershipMemoSchema,
  scoutReportScheduleId,
  scoutTaskQueues,
  type ScoutStage,
} from "@scout-for-lol/temporal";
import type { TemporalExecutionStartMetadata } from "@scout-for-lol/temporal/execution-metadata";

const MONTHS = [
  "JANUARY",
  "FEBRUARY",
  "MARCH",
  "APRIL",
  "MAY",
  "JUNE",
  "JULY",
  "AUGUST",
  "SEPTEMBER",
  "OCTOBER",
  "NOVEMBER",
  "DECEMBER",
] as const;
const DAYS = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;
const BoundarySchema = z.union([
  z.number().int(),
  z.enum(MONTHS),
  z.enum(DAYS),
]);
const RangeSchema = z.strictObject({
  start: BoundarySchema,
  end: BoundarySchema,
  step: z.number().int().positive(),
});
const CalendarSchema = z.strictObject({
  second: z.array(RangeSchema),
  minute: z.array(RangeSchema),
  hour: z.array(RangeSchema),
  dayOfMonth: z.array(RangeSchema),
  month: z.array(RangeSchema),
  year: z.array(RangeSchema),
  dayOfWeek: z.array(RangeSchema),
  comment: z.string(),
});
const ReportArgumentSchema = z.strictObject({
  stage: z.enum(["dev", "beta", "prod"]),
  reportId: z.string(),
  revision: z.number().int().nonnegative(),
  source: z.literal("schedule"),
});

type Calendar = z.infer<typeof CalendarSchema>;
type CalendarField = Exclude<keyof Calendar, "comment">;

function namedBoundary(value: string): number | undefined {
  const month = MONTHS.indexOf(value);
  if (month !== -1) return month + 1;
  const day = DAYS.indexOf(value);
  if (day !== -1) return day;
  return undefined;
}

function boundaryValue(value: number | string): number | undefined {
  return typeof value === "number" ? value : namedBoundary(value);
}

function expandRanges(ranges: Calendar[CalendarField]): number[] | undefined {
  const values: number[] = [];
  for (const range of ranges) {
    const start = boundaryValue(range.start);
    const end = boundaryValue(range.end);
    if (start === undefined || end === undefined || start > end)
      return undefined;
    for (let value = start; value <= end; value += range.step) {
      values.push(value);
    }
  }
  return [...new Set(values)].sort((left, right) => left - right);
}

function cronValues(
  values: readonly (number | string)[],
  normalizeSundayAlias = false,
): number[] | undefined {
  const result: number[] = [];
  for (const value of values) {
    const normalized = boundaryValue(value);
    if (normalized === undefined) return undefined;
    result.push(normalizeSundayAlias && normalized === 7 ? 0 : normalized);
  }
  return [...new Set(result)].sort((left, right) => left - right);
}

function valuesEqual(
  left: number[] | undefined,
  right: number[] | undefined,
): boolean {
  return (
    left?.length === right?.length &&
    left?.every((value, index) => value === right?.[index]) === true
  );
}

function calendarMatchesCron(
  description: ScheduleDescription,
  cronExpression: string,
  timezone: string,
): boolean {
  const calendars = description.spec.calendars ?? [];
  const calendar = CalendarSchema.safeParse(calendars[0]);
  if (
    calendars.length !== 1 ||
    !calendar.success ||
    calendar.data.comment !== "" ||
    (description.spec.intervals ?? []).length > 0 ||
    (description.spec.skip ?? []).length > 0 ||
    description.spec.startAt !== undefined ||
    description.spec.endAt !== undefined ||
    (description.spec.jitter !== undefined && description.spec.jitter !== 0) ||
    description.spec.timezone !== timezone ||
    calendar.data.year.length > 0
  ) {
    return false;
  }
  const fields = CronExpressionParser.parse(cronExpression).fields;
  return (
    valuesEqual(
      expandRanges(calendar.data.second),
      cronValues(fields.second.values),
    ) &&
    valuesEqual(
      expandRanges(calendar.data.minute),
      cronValues(fields.minute.values),
    ) &&
    valuesEqual(
      expandRanges(calendar.data.hour),
      cronValues(fields.hour.values),
    ) &&
    valuesEqual(
      expandRanges(calendar.data.dayOfMonth),
      cronValues(fields.dayOfMonth.values),
    ) &&
    valuesEqual(
      expandRanges(calendar.data.month),
      cronValues(fields.month.values),
    ) &&
    valuesEqual(
      expandRanges(calendar.data.dayOfWeek),
      cronValues(fields.dayOfWeek.values, true),
    )
  );
}

// The server backfills the deprecated untyped `searchAttributes` record from
// whatever typed search attributes are set (single-element value arrays), so
// a schedule started with execution metadata never actually describes back
// with an empty legacy record — only a schedule with NO typed attributes at
// all does.
function legacySearchAttributesMatch(
  value: unknown,
  expected: TemporalExecutionStartMetadata["typedSearchAttributes"],
): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (Object.keys(value).length !== expected.length) return false;
  return expected.every((pair) => {
    const actualValue: unknown = Reflect.get(value, pair.key.name);
    return (
      Array.isArray(actualValue) &&
      actualValue.length === 1 &&
      actualValue[0] === pair.value
    );
  });
}

function isDefaultPriority(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  if (Object.keys(value).length === 0) return true;
  return (
    Object.keys(value).toSorted().join(",") ===
      "fairnessKey,fairnessWeight,priorityKey" &&
    Reflect.get(value, "priorityKey") === undefined &&
    Reflect.get(value, "fairnessKey") === undefined &&
    Reflect.get(value, "fairnessWeight") === undefined
  );
}

function argumentMatches(
  args: readonly unknown[],
  input: { stage: ScoutStage; reportId: number; revision: number },
): boolean {
  const argument = ReportArgumentSchema.safeParse(args[0]);
  return (
    args.length === 1 &&
    argument.success &&
    argument.data.stage === input.stage &&
    argument.data.reportId === input.reportId.toString() &&
    argument.data.revision === input.revision
  );
}

function typedSearchAttributesMatch(
  actual: ScheduleDescription["action"]["typedSearchAttributes"],
  expected: TemporalExecutionStartMetadata["typedSearchAttributes"],
): boolean {
  if (actual === undefined) return expected.length === 0;
  const actualPairs = Array.isArray(actual) ? actual : actual.getAll();
  if (actualPairs.length !== expected.length) return false;
  const actualByName = new Map(
    actualPairs.map((pair) => [pair.key.name, pair.value]),
  );
  return expected.every(
    (pair) => actualByName.get(pair.key.name) === pair.value,
  );
}

function actionDefaultsMatch(
  action: ScheduleDescription["action"],
  executionMetadata: TemporalExecutionStartMetadata,
): boolean {
  return (
    action.memo === undefined &&
    legacySearchAttributesMatch(
      Reflect.get(action, "searchAttributes"),
      executionMetadata.typedSearchAttributes,
    ) &&
    typedSearchAttributesMatch(
      action.typedSearchAttributes,
      executionMetadata.typedSearchAttributes,
    ) &&
    action.retry === undefined &&
    action.workflowExecutionTimeout === 15 * 60 * 1000 &&
    action.workflowRunTimeout === undefined &&
    action.workflowTaskTimeout === undefined &&
    action.staticSummary === executionMetadata.staticSummary &&
    action.staticDetails === executionMetadata.staticDetails &&
    isDefaultPriority(action.priority)
  );
}

function actionMatches(
  description: ScheduleDescription,
  input: {
    stage: ScoutStage;
    reportId: number;
    revision: number;
    executionMetadata: TemporalExecutionStartMetadata;
  },
): boolean {
  const args = description.action.args ?? [];
  return (
    description.action.workflowId ===
      `${scoutReportScheduleId(input.stage, input.reportId.toString())}-workflow` &&
    description.action.workflowType === SCOUT_WORKFLOW_NAMES.reportRun &&
    description.action.taskQueue === scoutTaskQueues(input.stage).workflow &&
    argumentMatches(args, input) &&
    actionDefaultsMatch(description.action, input.executionMetadata)
  );
}

export function scheduleMatchesReport(
  description: ScheduleDescription,
  input: {
    stage: ScoutStage;
    reportId: number;
    revision: number;
    cronExpression: string;
    timezone: string;
    executionMetadata: TemporalExecutionStartMetadata;
  },
): boolean {
  const memo = ScoutScheduleOwnershipMemoSchema.safeParse(description.memo);
  return (
    memo.success &&
    memo.data.stage === input.stage &&
    memo.data.reportId === input.reportId.toString() &&
    actionMatches(description, input) &&
    calendarMatchesCron(description, input.cronExpression, input.timezone) &&
    description.policies.overlap === ScheduleOverlapPolicy.BUFFER_ONE &&
    description.policies.catchupWindow === 60 * 60 * 1000 &&
    !description.policies.pauseOnFailure
  );
}
