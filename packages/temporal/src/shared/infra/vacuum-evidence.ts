import type { EntityState, LogbookEntry } from "@shepherdjerred/home-assistant";

export type VacuumStartEvidence = {
  started: boolean;
  commandedReturn: boolean;
  currentState: string;
};

/** Recorder's baseline row may predate the request; it is not a start witness. */
export function classifyVacuumStartEvidence(
  entityId: string,
  requestedAt: string,
  current: EntityState,
  { history, logbook }: { history: EntityState[][]; logbook: LogbookEntry[] },
): VacuumStartEvidence {
  const requested = Date.parse(requestedAt);
  if (!Number.isFinite(requested))
    throw new TypeError("Invalid vacuum request time");
  const cleaningTimes = history.flat().flatMap((state) => {
    const changed = Date.parse(state.last_changed ?? "");
    return state.entity_id === entityId &&
      state.state === "cleaning" &&
      Number.isFinite(changed) &&
      changed >= requested
      ? [changed]
      : [];
  });
  const firstCleaning =
    cleaningTimes.length > 0 ? Math.min(...cleaningTimes) : undefined;
  const commandedReturn =
    firstCleaning !== undefined &&
    logbook.some(
      (entry) =>
        entry.entity_id === entityId &&
        (entry.state === "returning" ||
          entry.state === "docked" ||
          entry.state === "charging") &&
        Date.parse(entry.when) >= firstCleaning &&
        entry.context_event_type === "call_service" &&
        entry.context_domain === "vacuum" &&
        entry.context_service === "return_to_base",
    );
  return {
    started: firstCleaning !== undefined,
    commandedReturn,
    currentState: current.state,
  };
}
