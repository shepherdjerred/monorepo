import { z } from "zod";
import { BUCKS_INT32_MAX, BucksParlaySideSchema } from "@scout-for-lol/data";
import { MAX_CUSTOM_ID_LENGTH } from "#src/betting/custom-id.ts";

export const PARLAY_COMPONENT_NAMESPACE = "bbp";
export const PARLAY_COMPONENT_VERSION = "1";

const ParlayActionSchema = z.enum(["b", "x"]);

export const ParlayCustomIdSchema = z.strictObject({
  action: ParlayActionSchema,
  matchId: z.string().min(1),
  side: BucksParlaySideSchema,
  amount: z.number().int().nonnegative().max(BUCKS_INT32_MAX),
});

export type ParlayCustomId = z.infer<typeof ParlayCustomIdSchema>;

export function formatParlayCustomId(input: ParlayCustomId): string {
  const parsed = ParlayCustomIdSchema.parse(input);
  const id = [
    PARLAY_COMPONENT_NAMESPACE,
    PARLAY_COMPONENT_VERSION,
    parsed.action,
    parsed.matchId,
    parsed.side === "YES" ? "Y" : "N",
    parsed.amount.toString(),
  ].join(":");
  if (id.length > MAX_CUSTOM_ID_LENGTH) {
    throw new Error(
      `Bryan Bucks parlay custom ID is ${id.length.toString()} characters, over Discord's ${MAX_CUSTOM_ID_LENGTH.toString()} limit: ${id}`,
    );
  }
  return id;
}

const EXPECTED_SEGMENTS = 6;

export function parseParlayCustomId(raw: string): ParlayCustomId | undefined {
  const segments = raw.split(":");
  if (segments.length !== EXPECTED_SEGMENTS) return;
  const [namespace, version, action, matchId, compactSide, amount] = segments;
  if (
    namespace !== PARLAY_COMPONENT_NAMESPACE ||
    version !== PARLAY_COMPONENT_VERSION
  ) {
    return;
  }
  const side =
    compactSide === "Y" ? "YES" : compactSide === "N" ? "NO" : compactSide;
  const parsed = ParlayCustomIdSchema.safeParse({
    action,
    matchId,
    side,
    amount: Number(amount),
  });
  return parsed.success ? parsed.data : undefined;
}

export function isParlayCustomId(raw: string): boolean {
  return raw.startsWith(`${PARLAY_COMPONENT_NAMESPACE}:`);
}
