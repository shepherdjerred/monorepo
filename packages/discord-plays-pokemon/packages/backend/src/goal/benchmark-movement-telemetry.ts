import { z } from "zod";

export type MovementPosition = {
  map: string;
  x: number;
  y: number;
};

export type MovementObservation = {
  before: MovementPosition | undefined;
  after: MovementPosition | undefined;
  stopped: boolean;
};

export type MovementLoopState = {
  lastPosition: MovementPosition | undefined;
  visitedPositions: Set<string>;
};

const RecordSchema = z.record(z.string(), z.unknown());
const MovementPositionSchema = z.looseObject({
  map: z.union([z.string(), z.number()]).optional(),
  mapId: z.union([z.string(), z.number()]).optional(),
  mapGroup: z.number().int().optional(),
  mapNum: z.number().int().optional(),
  x: z.number().int(),
  y: z.number().int(),
});
const ActionOutcomeSchema = z.looseObject({
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  blocked: z.boolean().optional(),
  status: z.string().optional(),
  stopReason: z.string().nullable().optional(),
});

export function movementObservation(
  output: string,
): MovementObservation | undefined {
  const structured = structuredMovementObservation(output);
  if (structured !== undefined) return structured;
  const locations = legacyLocations(output);
  if (locations.length === 0) return undefined;
  return {
    before: locations.length > 1 ? locations.at(0) : undefined,
    after: locations.at(-1),
    stopped: false,
  };
}

export function positionLoopOccurred(
  state: MovementLoopState,
  observation: MovementObservation,
): boolean {
  const before = observation.before ?? state.lastPosition;
  const after = observation.after;
  if (before !== undefined) {
    state.visitedPositions.add(positionKey(before));
  }
  if (after === undefined) return false;
  const unchanged =
    before !== undefined && positionKey(before) === positionKey(after);
  const returned = !unchanged && state.visitedPositions.has(positionKey(after));
  state.visitedPositions.add(positionKey(after));
  state.lastPosition = after;
  return unchanged || returned;
}

function structuredMovementObservation(
  output: string,
): MovementObservation | undefined {
  const parsed = parseJsonOutput(output);
  if (parsed === undefined) return undefined;
  const outer = RecordSchema.safeParse(parsed);
  if (!outer.success) return undefined;
  const candidate = outer.data["outcome"] ?? outer.data;
  const outcome = ActionOutcomeSchema.safeParse(candidate);
  if (!outcome.success) return undefined;
  const before = movementPosition(outcome.data.before);
  const after = movementPosition(outcome.data.after);
  const hasActionOutcome =
    before !== undefined ||
    after !== undefined ||
    outcome.data.blocked !== undefined ||
    outcome.data.status !== undefined ||
    outcome.data.stopReason !== undefined;
  if (!hasActionOutcome) return undefined;
  const status = outcome.data.status?.toLowerCase().replaceAll("_", "-");
  const stoppedStatuses = new Set([
    "blocked",
    "stopped",
    "failed",
    "no-progress",
    "unchanged",
  ]);
  return {
    before,
    after,
    stopped:
      outcome.data.blocked === true ||
      (status !== undefined && stoppedStatuses.has(status)) ||
      (outcome.data.stopReason !== undefined &&
        outcome.data.stopReason !== null &&
        outcome.data.stopReason.trim().length > 0),
  };
}

function movementPosition(value: unknown): MovementPosition | undefined {
  const parsed = MovementPositionSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const position = parsed.data;
  const map =
    position.map ??
    position.mapId ??
    (position.mapGroup !== undefined && position.mapNum !== undefined
      ? `${String(position.mapGroup)}:${String(position.mapNum)}`
      : undefined);
  if (map === undefined) return undefined;
  return { map: String(map), x: position.x, y: position.y };
}

function parseJsonOutput(output: string): unknown {
  const trimmed = output.trim();
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace < firstBrace) return undefined;
  try {
    return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
  } catch {
    return undefined;
  }
}

function legacyLocations(output: string): MovementPosition[] {
  const locations: MovementPosition[] = [];
  for (const line of output.split("\n")) {
    const prefix = "Location:";
    const marker = " @ (";
    const prefixIndex = line.indexOf(prefix);
    const markerIndex = line.lastIndexOf(marker);
    if (prefixIndex === -1 || markerIndex <= prefixIndex + prefix.length) {
      continue;
    }
    const map = line.slice(prefixIndex + prefix.length, markerIndex).trim();
    const coordinates = /^(-?\d+),\s*(-?\d+)\)/u.exec(
      line.slice(markerIndex + marker.length),
    );
    if (map.length === 0 || coordinates === null) continue;
    const x = coordinates[1];
    const y = coordinates[2];
    if (x === undefined || y === undefined) continue;
    locations.push({
      map,
      x: Number.parseInt(x, 10),
      y: Number.parseInt(y, 10),
    });
  }
  return locations;
}

function positionKey(position: MovementPosition): string {
  return `${position.map}\u0000${String(position.x)}\u0000${String(position.y)}`;
}
