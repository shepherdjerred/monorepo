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

export function parsePinCandidates(text: string): PinCandidates {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error("pin candidates is not valid JSON", { cause: error });
  }
  return PinCandidatesSchema.parse(raw);
}
