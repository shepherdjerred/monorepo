import type { Task, TaskScheduleEntry } from "@shepherdjerred/facet-protocol";
import { addDays, civilDayOfInstant, type CivilDay } from "./civil-day.ts";

function wallOffsetAt(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const values = new Map(parts.map((part) => [part.type, Number(part.value)]));
  return (
    Date.UTC(
      values.get("year") ?? NaN,
      (values.get("month") ?? NaN) - 1,
      values.get("day") ?? NaN,
      values.get("hour") ?? NaN,
      values.get("minute") ?? NaN,
      values.get("second") ?? NaN,
    ) - instant
  );
}

export function isoForWallTime(
  day: CivilDay,
  time: string,
  timeZone: string,
): string {
  const wall = Date.parse(`${day}T${time}:00.000Z`);
  const dayMs = 86_400_000;
  const before = wall - wallOffsetAt(wall - dayMs, timeZone);
  const after = wall - wallOffsetAt(wall + dayMs, timeZone);
  const earlier = Math.min(before, after);
  // For repeated hours choose the first occurrence. For a missing hour advance by the gap.
  const instant =
    earlier + wallOffsetAt(earlier, timeZone) === wall
      ? earlier
      : Math.max(before, after);
  return new Date(instant).toISOString();
}

export function wallTimeForIso(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(instant));
}

function daysBetween(from: CivilDay, to: CivilDay): number {
  return (
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
    86_400_000
  );
}

export function moveTaskSchedule(
  task: Task,
  day: CivilDay,
  timeZone: string,
): TaskScheduleEntry {
  if (task.due_datetime === undefined || task.due_datetime === "")
    return { id: task.id, due_date: day, due_datetime: "", due_string: "" };
  const storedZone = task.due_timezone ?? "";
  const zone = storedZone === "" ? timeZone : storedZone;
  const currentViewerDay = civilDayOfInstant(task.due_datetime, timeZone);
  const currentTaskDay = civilDayOfInstant(task.due_datetime, zone);
  const wallTime = wallTimeForIso(task.due_datetime, zone);
  const taskDay = addDays(currentTaskDay, daysBetween(currentViewerDay, day));
  const proposed = isoForWallTime(taskDay, wallTime, zone);
  const correction = daysBetween(civilDayOfInstant(proposed, timeZone), day);
  const corrected =
    correction === 0
      ? proposed
      : isoForWallTime(addDays(taskDay, correction), wallTime, zone);
  const minuteRemainder =
    ((Date.parse(task.due_datetime) % 60_000) + 60_000) % 60_000;
  return {
    id: task.id,
    due_date: day,
    due_datetime: new Date(
      Date.parse(corrected) + minuteRemainder,
    ).toISOString(),
    due_string: "",
  };
}
