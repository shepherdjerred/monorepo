const CONFIGURATION_PAUSE_NOTE =
  "Paused automatically until required Glitter corpus credentials are configured";
const LEGACY_BILLED_COST_PAUSE_NOTE =
  "Awaiting Workflow candidate promotion with runLlmBilledCostReconciliation";
const CURRENT_BILLED_COST_PAUSE_PREFIX =
  "Awaiting 100% candidate traffic for runLlmBilledCostReconciliation";

type ScheduleStateDefinition = {
  requiredEnvironment?: readonly string[];
  requiredPresentEnvironment?: readonly string[];
  initialPauseNote?: string;
};

function migratedCandidatePauseNote(
  schedule: ScheduleStateDefinition,
  previous?: { paused: boolean; note?: string },
): string | undefined {
  return previous?.paused === true &&
    previous.note === LEGACY_BILLED_COST_PAUSE_NOTE &&
    schedule.initialPauseNote?.startsWith(CURRENT_BILLED_COST_PAUSE_PREFIX) ===
      true
    ? schedule.initialPauseNote
    : undefined;
}

export function buildScheduleState(
  schedule: ScheduleStateDefinition,
  env: Readonly<Record<string, string | undefined>>,
  previous?: { paused: boolean; note?: string },
  validateEnvironment = true,
): { paused: boolean; note?: string } {
  const missing = validateEnvironment
    ? (schedule.requiredEnvironment ?? []).filter((name) => {
        const value = env[name];
        return value === undefined || value === "";
      })
    : [];
  if (validateEnvironment) {
    missing.push(
      ...(schedule.requiredPresentEnvironment ?? []).filter(
        (name) => env[name] === undefined,
      ),
    );
  }
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
  const migratedNote = migratedCandidatePauseNote(schedule, previous);
  if (migratedNote !== undefined) return { paused: true, note: migratedNote };
  if (previous?.paused === true) {
    return previous.note === undefined
      ? { paused: true }
      : { paused: true, note: previous.note };
  }
  return previous === undefined && schedule.initialPauseNote !== undefined
    ? { paused: true, note: schedule.initialPauseNote }
    : { paused: false };
}
