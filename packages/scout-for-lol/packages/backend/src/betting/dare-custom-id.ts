import { z } from "zod";
import { BUCKS_INT32_MAX } from "@scout-for-lol/data";
import { MAX_CUSTOM_ID_LENGTH } from "#src/betting/custom-id.ts";

/**
 * Discord custom IDs for the `/bb dare` buttons.
 *
 * Format: `bbd:<version>:<action>:<dareId>` for confirm / cancel / accept /
 * decline, plus `bbd:<version>:p:<dareId>:<amount>` for a fixed-increment pot
 * contribution. The ID carries a key, never state: everything else — who may
 * click, what state the dare is in, whether the pot is still open — is
 * re-validated against the database before a Buck moves. Parsing never throws;
 * this is an unauthenticated surface (custom-id.ts precedent).
 */

export const DARE_COMPONENT_NAMESPACE = "bbd";
export const DARE_COMPONENT_VERSION = "1";

const DareIdSegmentSchema = z.number().int().positive().max(BUCKS_INT32_MAX);

export const DareCustomIdSchema = z.discriminatedUnion("action", [
  z.strictObject({
    /** `c` confirm (challenger) · `n` cancel (challenger) · `a` accept
     * (target) · `d` decline (target). */
    action: z.enum(["c", "n", "a", "d"]),
    dareId: DareIdSegmentSchema,
  }),
  z.strictObject({
    /** `p` piles a fixed increment onto the pot. */
    action: z.literal("p"),
    dareId: DareIdSegmentSchema,
    amount: z.number().int().min(1).max(BUCKS_INT32_MAX),
  }),
]);

export type DareCustomId = z.infer<typeof DareCustomIdSchema>;

export function formatDareCustomId(input: DareCustomId): string {
  const parsed = DareCustomIdSchema.parse(input);
  const segments = [
    DARE_COMPONENT_NAMESPACE,
    DARE_COMPONENT_VERSION,
    parsed.action,
    parsed.dareId.toString(),
  ];
  if (parsed.action === "p") {
    segments.push(parsed.amount.toString());
  }
  const id = segments.join(":");
  if (id.length > MAX_CUSTOM_ID_LENGTH) {
    throw new Error(
      `Bryan Bucks dare custom ID is ${id.length.toString()} characters, over Discord's ${MAX_CUSTOM_ID_LENGTH.toString()} limit: ${id}`,
    );
  }
  return id;
}

const BASE_SEGMENTS = 4;
const CONTRIBUTION_SEGMENTS = 5;

/** Parse a dare custom ID, or return undefined. Never throws — a stale or
 * forged ID is an ordinary occurrence, not an exception. */
export function parseDareCustomId(raw: string): DareCustomId | undefined {
  const segments = raw.split(":");
  if (
    segments.length !== BASE_SEGMENTS &&
    segments.length !== CONTRIBUTION_SEGMENTS
  ) {
    return undefined;
  }
  const [namespace, version, action, dareId, amount] = segments;
  if (
    namespace !== DARE_COMPONENT_NAMESPACE ||
    version !== DARE_COMPONENT_VERSION
  ) {
    return undefined;
  }
  const candidate =
    segments.length === CONTRIBUTION_SEGMENTS
      ? { action, dareId: Number(dareId), amount: Number(amount) }
      : { action, dareId: Number(dareId) };
  const result = DareCustomIdSchema.safeParse(candidate);
  return result.success ? result.data : undefined;
}

/** Whether a custom ID belongs to the dare feature at all, without validating
 * it. Used by the dispatcher to decide whether to claim the interaction. */
export function isDareCustomId(raw: string): boolean {
  return raw.startsWith(`${DARE_COMPONENT_NAMESPACE}:`);
}
