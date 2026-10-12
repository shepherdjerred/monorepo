import { z } from "zod";

/**
 * Wire contract shared by image publication and pin commit-back. Keep parsing
 * independent of branch reconciliation so readers need no merge machinery.
 * gitSha is optional for historical pins minted before image provenance was
 * recorded; it identifies the source baked into a Worker Deployment's image.
 */
export const PinCandidateSchema = z
  .object({
    version: z.string().min(1),
    digest: z
      .string()
      .regex(/^sha256:[0-9a-f]{64}$/, "digest must be canonical sha256"),
    gitSha: z
      .string()
      .regex(/^[0-9a-f]{40}$/, "gitSha must be a 40-character lowercase commit")
      .optional(),
  })
  .strict();

export const PinCandidatesSchema = z
  .object({
    schema: z.literal("pin-candidates/v1"),
    buildNumber: z.number().int().positive(),
    candidates: z.record(z.string().min(1), PinCandidateSchema),
  })
  .strict();

export type PinCandidates = z.infer<typeof PinCandidatesSchema>;

export const PinCandidatesStateSchema = z
  .object({
    schema: z.literal("pin-candidates-state/v1"),
    pins: z.record(
      z.string().min(1),
      PinCandidateSchema.extend({ buildNumber: z.number().int().positive() }),
    ),
    withdrawnCandidates: z
      .record(
        z.string().regex(/\/workflows\/candidate$/u),
        z.number().int().positive(),
      )
      .optional(),
  })
  .strict();

export type PinCandidatesState = z.infer<typeof PinCandidatesStateSchema>;

export function parsePinCandidatesState(text: string): PinCandidatesState {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error("pin candidate state is not valid JSON", { cause: error });
  }
  return PinCandidatesStateSchema.parse(raw);
}

export function imageKeys(versions: Map<string, string>): Set<string> {
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
  for (const key of Object.keys(state.withdrawnCandidates ?? {})) {
    if (!allowed.has(key)) {
      throw new Error(`withdrawn candidate contains unknown image key ${key}`);
    }
  }
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
    const withdrawn = state.withdrawnCandidates?.[key];
    if (withdrawn !== undefined && pin.buildNumber <= withdrawn) {
      throw new Error(`withdrawn candidate remains in pin state: ${key}`);
    }
  }
}

export function parsePinCandidates(text: string): PinCandidates {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error("pin candidates is not valid JSON", { cause: error });
  }
  return PinCandidatesSchema.parse(raw);
}
