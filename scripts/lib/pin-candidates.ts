import { z } from "zod";
import { format } from "prettier";
import {
  parseVersionCatalogText,
  serializeVersionCatalog,
  type VersionCatalog,
  type VersionCatalogEntry,
} from "@shepherdjerred/version-catalog";
import {
  PinCandidateSchema,
  type PinCandidates,
} from "./pin-candidates-schema.ts";

const PinSchema = PinCandidateSchema.extend({
  buildNumber: z.number().int().positive(),
});

export const PinCandidatesStateSchema = z
  .object({
    schema: z.literal("pin-candidates-state/v1"),
    pins: z.record(z.string().min(1), PinSchema),
  })
  .strict();

export type PinCandidatesState = z.infer<typeof PinCandidatesStateSchema>;
type PinStatePin = PinCandidatesState["pins"][string];

function parseJson(text: string, description: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${description} is not valid JSON`, { cause: error });
  }
}

export function parsePinCandidatesState(text: string): PinCandidatesState {
  return PinCandidatesStateSchema.parse(parseJson(text, "pin candidate state"));
}

export function serializePinCandidatesState(state: PinCandidatesState): string {
  const pins = Object.fromEntries(
    Object.entries(state.pins).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return `${JSON.stringify({ schema: state.schema, pins }, null, 2)}\n`;
}

export function parseVersionCatalogSource(source: string): Map<string, string> {
  const catalog = parseVersionCatalogText(source);
  return new Map(catalog.entries.map((entry) => [entry.name, entry.value]));
}

function sameVersionCatalogEntry(
  left: VersionCatalogEntry | undefined,
  right: VersionCatalogEntry | undefined,
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Apply pending catalog changes on top of main using their merge base.
 * Main wins concurrent catalog edits, including retirements; generated pin
 * state is merged separately and rewrites the selected image values later.
 */
export function mergeVersionCatalogSources(
  mainSource: string,
  pendingSource: string,
  baseSource: string,
  supersededPendingKeys: ReadonlySet<string> = new Set(),
): string {
  const main = parseVersionCatalogText(mainSource);
  const pending = parseVersionCatalogText(pendingSource);
  const base = parseVersionCatalogText(baseSource);
  const mainEntries = new Map(main.entries.map((entry) => [entry.name, entry]));
  const pendingEntries = new Map(
    pending.entries.map((entry) => [entry.name, entry]),
  );
  const baseEntries = new Map(base.entries.map((entry) => [entry.name, entry]));
  const names = new Set([
    ...main.entries.map((entry) => entry.name),
    ...pending.entries.map((entry) => entry.name),
  ]);
  const entries: VersionCatalogEntry[] = [];

  for (const name of names) {
    const mainEntry = mainEntries.get(name);
    const pendingEntry = pendingEntries.get(name);
    const baseEntry = baseEntries.get(name);
    const mergedEntry = supersededPendingKeys.has(name)
      ? mainEntry
      : sameVersionCatalogEntry(pendingEntry, baseEntry)
        ? mainEntry
        : sameVersionCatalogEntry(mainEntry, baseEntry)
          ? pendingEntry
          : mainEntry;
    if (mergedEntry !== undefined) entries.push(mergedEntry);
  }

  return serializeVersionCatalog({ ...main, entries });
}

function imageKeys(versions: Map<string, string>): Set<string> {
  return new Set(
    [...versions.entries()]
      .filter(([, value]) => value.includes("@sha256:"))
      .map(([key]) => key),
  );
}

export function validateStateAgainstVersions(
  state: PinCandidatesState,
  versions: Map<string, string>,
): void {
  const allowed = imageKeys(versions);
  for (const [key, pin] of Object.entries(state.pins)) {
    if (!allowed.has(key)) {
      throw new Error(`pin state contains unknown image key ${key}`);
    }
    const actual = versions.get(key);
    const expected = `${pin.version}@${pin.digest}`;
    if (actual !== expected) {
      throw new Error(
        `pin state drift for ${key}: expected ${expected}, found ${String(actual)}`,
      );
    }
  }
}

/**
 * Keep only pins for images that still exist in the current catalog.
 *
 * A pending generated bump branch can be based on a catalog from before main
 * retired an image. Its state is valid against that branch's catalog, but the
 * retired key must not be merged back into a bump reconstructed from current
 * main.
 */
export function retainCurrentImagePins(
  state: PinCandidatesState,
  versions: Map<string, string>,
): { state: PinCandidatesState; retiredKeys: string[] } {
  const allowed = imageKeys(versions);
  const entries = Object.entries(state.pins);
  const retained = entries.filter(([key]) => allowed.has(key));
  const retiredKeys = entries
    .filter(([key]) => !allowed.has(key))
    .map(([key]) => key);
  return {
    state: {
      schema: state.schema,
      pins: Object.fromEntries(retained),
    },
    retiredKeys,
  };
}

export function validateCandidateKeys(
  candidates: PinCandidates,
  versions: Map<string, string>,
): void {
  const allowed = imageKeys(versions);
  for (const key of Object.keys(candidates.candidates)) {
    if (!allowed.has(key)) {
      throw new Error(`candidate contains unknown image key ${key}`);
    }
  }
}

function pinsEqual(
  left: { version: string; digest: string },
  right: { version: string; digest: string },
): boolean {
  return left.version === right.version && left.digest === right.digest;
}

function mergeSameBuildPins(
  key: string,
  current: PinStatePin,
  incoming: PinStatePin,
): PinStatePin {
  if (
    !pinsEqual(current, incoming) ||
    (current.gitSha !== undefined &&
      incoming.gitSha !== undefined &&
      current.gitSha !== incoming.gitSha)
  ) {
    throw new Error(
      `conflicting candidates for ${key} at build ${current.buildNumber.toString()}`,
    );
  }
  // Older pins have no gitSha. Preserve the known image commit when one side
  // enriches an otherwise identical pin.
  return current.gitSha === undefined ? incoming : current;
}

function samePinState(
  left: PinStatePin | undefined,
  right: PinStatePin | undefined,
): boolean {
  return left === undefined || right === undefined
    ? left === right
    : left.buildNumber === right.buildNumber &&
        left.version === right.version &&
        left.digest === right.digest &&
        left.gitSha === right.gitSha;
}

/**
 * Find pending pins that main carried after the merge base and later changed
 * away from. This catches generated PRs squash-merged into main and then
 * explicitly reset before the pending branch itself is rewritten.
 */
export function findSupersededPendingPinKeys(
  main: PinCandidatesState,
  pending: PinCandidatesState,
  base: PinCandidatesState,
  mainHistory: readonly PinCandidatesState[],
): Set<string> {
  const superseded = new Set<string>();
  for (const [key, pendingPin] of Object.entries(pending.pins)) {
    if (
      samePinState(pendingPin, base.pins[key]) ||
      samePinState(main.pins[key], pendingPin)
    ) {
      continue;
    }
    if (
      mainHistory.some((snapshot) =>
        samePinState(snapshot.pins[key], pendingPin),
      )
    ) {
      superseded.add(key);
    }
  }
  return superseded;
}

function mergePinStateEntry(
  key: string,
  main: PinStatePin | undefined,
  pending: PinStatePin | undefined,
  base: PinStatePin | undefined,
): PinStatePin | undefined {
  if (samePinState(pending, base)) return main;
  if (samePinState(main, base)) return pending;
  if (main === undefined) {
    return pending !== undefined &&
      (base === undefined || pending.buildNumber > base.buildNumber)
      ? pending
      : undefined;
  }
  if (pending === undefined || pending.buildNumber < main.buildNumber) {
    return main;
  }
  return pending.buildNumber > main.buildNumber
    ? pending
    : mergeSameBuildPins(key, main, pending);
}

export function mergePinStates(
  main: PinCandidatesState,
  pending: PinCandidatesState,
  base: PinCandidatesState,
  supersededPendingKeys: ReadonlySet<string> = new Set(),
): PinCandidatesState {
  const pins = new Map(Object.entries(main.pins));
  const keys = new Set([
    ...Object.keys(base.pins),
    ...Object.keys(main.pins),
    ...Object.keys(pending.pins),
  ]);

  for (const key of keys) {
    const result = supersededPendingKeys.has(key)
      ? main.pins[key]
      : mergePinStateEntry(
          key,
          main.pins[key],
          pending.pins[key],
          base.pins[key],
        );
    if (result === undefined) pins.delete(key);
    else pins.set(key, result);
  }

  return { schema: main.schema, pins: Object.fromEntries(pins) };
}

export function mergePinCandidates(
  state: PinCandidatesState,
  batch: PinCandidates,
): PinCandidatesState {
  const pins = { ...state.pins };
  for (const [key, candidate] of Object.entries(batch.candidates)) {
    const current = pins[key];
    if (current === undefined || batch.buildNumber > current.buildNumber) {
      pins[key] = { buildNumber: batch.buildNumber, ...candidate };
      continue;
    }
    if (batch.buildNumber < current.buildNumber) {
      continue;
    }
    pins[key] = mergeSameBuildPins(key, current, {
      buildNumber: batch.buildNumber,
      ...candidate,
    });
  }
  return { schema: "pin-candidates-state/v1", pins };
}

export async function rewriteVersionCatalogSource(
  source: string,
  state: PinCandidatesState,
): Promise<string> {
  const catalog = parseVersionCatalogText(source);
  const pins = new Map(Object.entries(state.pins));
  const rewritten: VersionCatalog = {
    ...catalog,
    entries: catalog.entries.map((entry) => {
      const pin = pins.get(entry.name);
      return pin === undefined
        ? entry
        : {
            ...entry,
            value: `${pin.version}@${pin.digest}`,
          };
    }),
  };
  for (const key of pins.keys()) {
    if (!catalog.entries.some((entry) => entry.name === key)) {
      throw new Error(
        `version catalog does not contain exact image key ${key}`,
      );
    }
  }
  return await format(serializeVersionCatalog(rewritten), { parser: "json" });
}
