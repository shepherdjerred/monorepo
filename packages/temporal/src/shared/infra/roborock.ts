export const ROBOROCK_VACUUM_ENTITIES = [
  "vacuum.1st_floor",
  "vacuum.2nd_floor",
  "vacuum.3rd_floor",
] as const;

export const ROBOROCK_UNAVAILABLE_SETTLE_MS = 3 * 60 * 1000;
export const ROBOROCK_RELOAD_COOLDOWN_MS = 30 * 60 * 1000;

export function firstUnavailableRoborock(
  states: readonly { entity_id: string; state: string }[],
): string | undefined {
  const stateByEntityId = new Map(
    states.map((entry) => [entry.entity_id, entry.state]),
  );
  return ROBOROCK_VACUUM_ENTITIES.find(
    (entityId) => stateByEntityId.get(entityId) === "unavailable",
  );
}
