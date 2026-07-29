import { z } from "zod";

const DigestSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/, "digest must be canonical sha256");
const VersionSchema = z.string().min(1);
const CandidateSchema = z
  .object({ version: VersionSchema, digest: DigestSchema })
  .strict();
const PinSchema = CandidateSchema.extend({
  buildNumber: z.number().int().positive(),
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

export function parseVersionsSource(source: string): Map<string, string> {
  const entries = new Map<string, string>();
  const entryPattern = /"([^"]+)"\s*:\s*"([^"]*)"/g;
  for (const match of source.matchAll(entryPattern)) {
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined) {
      throw new Error("versions.ts entry parser returned an incomplete match");
    }
    if (entries.has(key)) {
      throw new Error(`versions.ts contains duplicate key ${key}`);
    }
    entries.set(key, value);
  }
  return entries;
}

export function reconstructLegacyPinState(
  baseVersions: Map<string, string>,
  pendingVersions: Map<string, string>,
  buildNumber: number,
): PinCandidatesState {
  let state = PinCandidatesStateSchema.parse({
    schema: "pin-candidates-state/v1",
    pins: {},
  });
  for (const [key, pendingValue] of pendingVersions) {
    const baseValue = baseVersions.get(key);
    if (pendingValue === baseValue) {
      continue;
    }
    const baseIsImage = baseValue?.includes("@sha256:") ?? false;
    if (!baseIsImage) {
      throw new Error(`legacy bump changed non-image version ${key}`);
    }
    const separator = pendingValue.lastIndexOf("@");
    const version = pendingValue.slice(0, separator);
    const digest = pendingValue.slice(separator + 1);
    state = mergePinCandidates(
      state,
      PinCandidatesSchema.parse({
        schema: "pin-candidates/v1",
        buildNumber,
        candidates: { [key]: { version, digest } },
      }),
    );
  }
  return state;
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

export function mergePinStates(
  base: PinCandidatesState,
  pending: PinCandidatesState,
): PinCandidatesState {
  let merged = base;
  for (const [key, pin] of Object.entries(pending.pins)) {
    merged = mergePinCandidates(merged, {
      schema: "pin-candidates/v1",
      buildNumber: pin.buildNumber,
      candidates: {
        [key]: { version: pin.version, digest: pin.digest },
      },
    });
  }
  return merged;
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

export function rewriteVersionsSource(
  source: string,
  state: PinCandidatesState,
): string {
  let rewritten = source;
  for (const [key, pin] of Object.entries(state.pins)) {
    const escapedKey = key.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
    const pattern = new RegExp(
      String.raw`("${escapedKey}"\s*:\s*)"([^"]*)"(\s*,?)`,
    );
    if (!pattern.test(rewritten)) {
      throw new Error(`versions.ts does not contain exact image key ${key}`);
    }
    rewritten = rewritten.replace(
      pattern,
      `$1"${pin.version}@${pin.digest}"$3`,
    );
  }
  return rewritten;
}
