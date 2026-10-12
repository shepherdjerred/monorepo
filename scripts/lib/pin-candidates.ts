import { format } from "prettier";
import {
  parseVersionCatalogText,
  serializeVersionCatalog,
  type VersionCatalog,
  type VersionCatalogEntry,
} from "@shepherdjerred/version-catalog";
import {
  imageKeys,
  type PinCandidates,
  type PinCandidatesState,
} from "./pin-candidates-schema.ts";
type PinStatePin = PinCandidatesState["pins"][string];

export function serializePinCandidatesState(state: PinCandidatesState): string {
  const pins = Object.fromEntries(
    Object.entries(state.pins).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
  return `${JSON.stringify({ ...state, pins }, null, 2)}\n`;
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
      ...state,
      pins: Object.fromEntries(retained),
      ...(state.withdrawnCandidates === undefined
        ? {}
        : {
            withdrawnCandidates: Object.fromEntries(
              Object.entries(state.withdrawnCandidates).filter(([key]) =>
                allowed.has(key),
              ),
            ),
          }),
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
  const withdrawnCandidates: Record<string, number> = {};
  for (const state of [base, main, pending]) {
    for (const [key, build] of Object.entries(
      state.withdrawnCandidates ?? {},
    )) {
      withdrawnCandidates[key] = Math.max(withdrawnCandidates[key] ?? 0, build);
    }
  }
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
    if (
      result === undefined ||
      result.buildNumber <= (withdrawnCandidates[key] ?? 0)
    )
      pins.delete(key);
    else pins.set(key, result);
  }

  return {
    schema: main.schema,
    pins: Object.fromEntries(pins),
    ...(Object.keys(withdrawnCandidates).length === 0
      ? {}
      : { withdrawnCandidates }),
  };
}

export function mergePinCandidates(
  state: PinCandidatesState,
  batch: PinCandidates,
): PinCandidatesState {
  const pins = { ...state.pins };
  for (const [key, candidate] of Object.entries(batch.candidates)) {
    if (batch.buildNumber <= (state.withdrawnCandidates?.[key] ?? 0)) continue;
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
  return { ...state, pins };
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
