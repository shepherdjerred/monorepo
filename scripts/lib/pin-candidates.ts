import { z } from "zod";
import { format } from "prettier";
import {
  parseVersionCatalogText,
  serializeVersionCatalog,
  type VersionCatalog,
} from "@shepherdjerred/version-catalog";

const DigestSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, "digest must be canonical sha256");
const VersionSchema = z.string().min(1);
const CandidateSchema = z
  .object({ version: VersionSchema, digest: DigestSchema })
  .strict();
/**
 * The commit an image was built from, as baked into its `GIT_SHA`.
 *
 * Optional because pins minted before this field existed have none. Without
 * it a pin records only a version and a digest, and the commit it corresponds
 * to lives nowhere in the repo — so a reviewer cannot tell `2.0.0-13000` from
 * `2.0.0-13153` and an operator has nothing to contradict a wrong assumption.
 * That is precisely how a Worker Deployment came to route to a Build ID no
 * running pod carried. Build numbers do not order with commits: 13000 is
 * `3f9be51c` while 13153 is `c42ee297`.
 */
const GitShaSchema = z
  .string()
  .regex(/^[0-9a-f]{40}$/, "gitSha must be a 40-character lowercase commit");
const PinSchema = CandidateSchema.extend({
  buildNumber: z.number().int().positive(),
  gitSha: GitShaSchema.optional(),
});

export const PinCandidatesSchema = z
  .object({
    schema: z.literal("pin-candidates/v1"),
    buildNumber: z.number().int().positive(),
    candidates: z.record(z.string().min(1), CandidateSchema),
  })
  .strict();

export const PinCandidatesStateSchema = z
  .object({
    schema: z.literal("pin-candidates-state/v1"),
    pins: z.record(z.string().min(1), PinSchema),
  })
  .strict();

export type PinCandidates = z.infer<typeof PinCandidatesSchema>;
export type PinCandidatesState = z.infer<typeof PinCandidatesStateSchema>;
type PinStatePin = PinCandidatesState["pins"][string];

function parseJson(text: string, description: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${description} is not valid JSON`, { cause: error });
  }
}

export function parsePinCandidates(text: string): PinCandidates {
  return PinCandidatesSchema.parse(parseJson(text, "pin candidates"));
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
  if (pending.buildNumber > main.buildNumber) return pending;
  if (!pinsEqual(main, pending)) {
    throw new Error(
      `conflicting candidates for ${key} at build ${main.buildNumber.toString()}`,
    );
  }
  return main;
}

export function mergePinStates(
  main: PinCandidatesState,
  pending: PinCandidatesState,
  base: PinCandidatesState,
): PinCandidatesState {
  const pins = new Map(Object.entries(main.pins));
  const keys = new Set([
    ...Object.keys(base.pins),
    ...Object.keys(main.pins),
    ...Object.keys(pending.pins),
  ]);

  for (const key of keys) {
    const result = mergePinStateEntry(
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
    if (!pinsEqual(current, candidate)) {
      throw new Error(
        `conflicting candidates for ${key} at build ${batch.buildNumber.toString()}`,
      );
    }
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
