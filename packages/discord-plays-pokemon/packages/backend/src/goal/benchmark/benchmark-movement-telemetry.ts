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
const ObservationSchema = z.looseObject({
  world: z.unknown().nullable(),
});
const ActionObservationSchema = z.looseObject({
  phase: z.string().optional(),
  context: z
    .union([
      z.string(),
      z.looseObject({
        kind: z.string(),
      }),
    ])
    .optional(),
});
const ActionOutcomeSchema = z.looseObject({
  action: z.string().optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  blocked: z.boolean().optional(),
  status: z.string().optional(),
  stopReason: z.string().nullable().optional(),
});

type StructuredMovementObservation = Readonly<{
  observation: MovementObservation;
  action: string | undefined;
  fieldContext: boolean | undefined;
}>;

const DIRECTIONAL_ARGUMENTS = new Set([
  "north",
  "south",
  "west",
  "east",
  "up",
  "down",
  "left",
  "right",
  "u",
  "d",
  "l",
  "r",
]);

export function directionalMovementObservations(
  command: string,
  output: string,
): readonly MovementObservation[] {
  const structured = structuredMovementObservations(output);
  const observations: MovementObservation[] = [];
  for (const entry of structured) {
    const structuredDecision = structuredMovementDecision(entry);
    if (structuredDecision === true) {
      observations.push(entry.observation);
      continue;
    }
    if (
      structuredDecision === undefined &&
      isDirectionalMovementCommand(command) &&
      entry.fieldContext !== false
    ) {
      observations.push(entry.observation);
    }
  }
  if (structured.length > 0) return observations;
  if (!isDirectionalMovementCommand(command)) return [];
  const locations = legacyLocations(output);
  if (locations.length === 0) return [];
  return [
    {
      before: locations.length > 1 ? locations.at(0) : undefined,
      after: locations.at(-1),
      stopped: false,
    },
  ];
}

function movementObservation(
  parsed: unknown,
): StructuredMovementObservation | undefined {
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
  const normalStopReasons = new Set(["completed", "target-reached"]);
  const stopReason = outcome.data.stopReason?.trim().toLowerCase();
  return {
    observation: {
      before,
      after,
      stopped:
        outcome.data.blocked === true ||
        (status !== undefined && stoppedStatuses.has(status)) ||
        (stopReason !== undefined &&
          stopReason.length > 0 &&
          !normalStopReasons.has(stopReason)),
    },
    action: outcome.data.action,
    fieldContext:
      fieldContext(outcome.data.before) ?? fieldContext(outcome.data.after),
  };
}

function structuredMovementObservations(
  output: string,
): readonly StructuredMovementObservation[] {
  const observations: StructuredMovementObservation[] = [];
  for (const parsed of parseJsonOutputs(output)) {
    const observation = movementObservation(parsed);
    if (observation !== undefined) observations.push(observation);
  }
  return observations;
}

function parseJsonOutputs(output: string): readonly unknown[] {
  const wholeOutput = parseJsonValue(output);
  if (wholeOutput !== undefined) return [wholeOutput];
  const parsed: unknown[] = [];
  for (const line of output.split("\n")) {
    const value = parseJsonValue(line);
    if (value !== undefined) parsed.push(value);
  }
  return parsed;
}

function parseJsonValue(output: string): unknown {
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

function structuredMovementDecision(
  structured: StructuredMovementObservation,
): boolean | undefined {
  const action = structured.action?.trim().toLowerCase();
  if (action === undefined) return undefined;
  if (
    action === "navigate" ||
    /^move:(?:north|south|west|east)$/u.test(action)
  ) {
    return true;
  }
  const tap = /^tap:([a-z]+)$/u.exec(action);
  if (tap !== null) {
    const argument = tap[1];
    if (argument === undefined || !DIRECTIONAL_ARGUMENTS.has(argument)) {
      return false;
    }
    return structured.fieldContext;
  }
  if (
    action === "interact" ||
    action === "advance" ||
    action === "chord:raw" ||
    action.startsWith("wait:")
  ) {
    return false;
  }
  return undefined;
}

function fieldContext(value: unknown): boolean | undefined {
  const parsed = ActionObservationSchema.safeParse(value);
  if (!parsed.success) return undefined;
  if (parsed.data.phase !== undefined) {
    return parsed.data.phase === "overworld";
  }
  const context = parsed.data.context;
  if (typeof context === "string") return context === "field";
  return context?.kind === undefined ? undefined : context.kind === "field";
}

function isDirectionalMovementCommand(command: string): boolean {
  const invocation =
    /(?:^|[\s"'`;|&])(?:[^\s"'`;|&]+\/)?pokemonctl["']?\s+(navigate|move|tap|press)\b(?:\s+["']?([a-z]+)["']?)?/giu;
  for (const match of command.matchAll(invocation)) {
    const subcommand = match[1]?.toLowerCase();
    if (subcommand === "navigate") return true;
    const argument = match[2]?.toLowerCase();
    if (
      argument !== undefined &&
      (subcommand === "move" ||
        subcommand === "tap" ||
        subcommand === "press") &&
      DIRECTIONAL_ARGUMENTS.has(argument)
    ) {
      return true;
    }
  }
  return false;
}

function movementPosition(value: unknown): MovementPosition | undefined {
  const observation = ObservationSchema.safeParse(value);
  if (observation.success) {
    return observation.data.world === null
      ? undefined
      : movementPosition(observation.data.world);
  }
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
    if (coordinates === null || map.length === 0) continue;
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
  return `${position.map}\u{0}${String(position.x)}\u{0}${String(position.y)}`;
}
