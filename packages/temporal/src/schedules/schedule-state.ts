const CONFIGURATION_PAUSE_NOTE =
  "Paused automatically until required Glitter corpus credentials are configured";

type ScheduleStateDefinition = {
  requiredEnvironment?: readonly string[];
  initialPauseNote?: string;
};

export function buildScheduleState(
  schedule: ScheduleStateDefinition,
  env: Readonly<Record<string, string | undefined>>,
  previous?: { paused: boolean; note?: string },
): { paused: boolean; note?: string } {
  const missing = (schedule.requiredEnvironment ?? []).filter((name) => {
    const value = env[name];
    return value === undefined || value === "";
  });
  if (missing.length > 0) {
    return {
      paused: true,
      note: `${CONFIGURATION_PAUSE_NOTE}: ${missing.join(", ")}`,
    };
  }
  if (
    previous?.paused === true &&
    previous.note?.startsWith(CONFIGURATION_PAUSE_NOTE) === true
  ) {
    return schedule.initialPauseNote === undefined
      ? previous
      : { paused: true, note: schedule.initialPauseNote };
  }
  if (previous?.paused === true) {
    return previous.note === undefined
      ? { paused: true }
      : { paused: true, note: previous.note };
  }
  if (previous === undefined && schedule.initialPauseNote !== undefined) {
    return { paused: true, note: schedule.initialPauseNote };
  }
  return { paused: false };
}
