import { z } from "zod";
import { BUCKS_INT32_MAX, BucksParlaySideSchema } from "@scout-for-lol/data";
import { MAX_CUSTOM_ID_LENGTH } from "#src/betting/custom-id.ts";

export const WEEKLY_PARLAY_COMPONENT_NAMESPACE = "bbw";
export const WEEKLY_PARLAY_COMPONENT_VERSION = "1";

export const WeeklyParlayCustomIdSchema = z.strictObject({
  action: z.enum(["b", "x"]),
  marketId: z.number().int().positive(),
  side: BucksParlaySideSchema,
  amount: z.number().int().nonnegative().max(BUCKS_INT32_MAX),
});
export type WeeklyParlayCustomId = z.infer<typeof WeeklyParlayCustomIdSchema>;

export function formatWeeklyParlayCustomId(
  input: WeeklyParlayCustomId,
): string {
  const parsed = WeeklyParlayCustomIdSchema.parse(input);
  const id = [
    WEEKLY_PARLAY_COMPONENT_NAMESPACE,
    WEEKLY_PARLAY_COMPONENT_VERSION,
    parsed.action,
    parsed.marketId.toString(36),
    parsed.side === "YES" ? "Y" : "N",
    parsed.amount.toString(36),
  ].join(":");
  if (id.length > MAX_CUSTOM_ID_LENGTH) {
    throw new Error("Weekly parlay custom ID exceeds Discord's limit.");
  }
  return id;
}

export function parseWeeklyParlayCustomId(
  raw: string,
): WeeklyParlayCustomId | undefined {
  const [namespace, version, action, market, compactSide, amount, extra] =
    raw.split(":");
  if (
    extra !== undefined ||
    namespace !== WEEKLY_PARLAY_COMPONENT_NAMESPACE ||
    version !== WEEKLY_PARLAY_COMPONENT_VERSION
  ) {
    return;
  }
  const parsed = WeeklyParlayCustomIdSchema.safeParse({
    action,
    marketId: Number.parseInt(market ?? "", 36),
    side:
      compactSide === "Y" ? "YES" : compactSide === "N" ? "NO" : compactSide,
    amount: Number.parseInt(amount ?? "", 36),
  });
  return parsed.success ? parsed.data : undefined;
}

export function isWeeklyParlayCustomId(raw: string): boolean {
  return raw.startsWith(`${WEEKLY_PARLAY_COMPONENT_NAMESPACE}:`);
}
