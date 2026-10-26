import type {
  PromotionObservation,
  PromotionTarget,
} from "#shared/promotion.ts";

export function assertPromotionReceipt(input: {
  target: PromotionTarget;
  status: "verified" | "filtered" | "rejected";
  url: string;
  text: string;
  quote: string;
  attemptedAt: string;
  publishedAt?: string | null | undefined;
  before: readonly PromotionObservation[];
}): void {
  if (input.status !== "verified") return;
  if (
    input.target.action === "bump" &&
    !input.before.some((page) => page.url === input.url)
  )
    throw new Error("Bump receipt requires the original page baseline");
  if (
    input.before.some(
      (page) => page.url === input.url && page.text.includes(input.quote),
    )
  )
    throw new Error("Confirmation was already present before submission");
  if (input.target.action === "bump" && !/bump(?:ed|ing)?/i.test(input.quote))
    throw new Error("Native bump receipt must explicitly confirm a bump");
  if (!input.target.id.startsWith("reddit-")) return;
  if (!/\/comments\/[a-z0-9]+\//i.test(new URL(input.url).pathname))
    throw new Error(
      "Reddit confirmation requires the submitted post permalink",
    );
  if (
    /removed by|\[removed\]|pending approval|awaiting moderator/i.test(
      input.text,
    )
  )
    throw new Error("Reddit receipt shows a removed or pending post");
  const published =
    input.publishedAt === null || input.publishedAt === undefined
      ? Number.NaN
      : Date.parse(input.publishedAt);
  if (
    !Number.isFinite(published) ||
    published < Date.parse(input.attemptedAt) - 60_000
  )
    throw new Error("Reddit post timestamp does not establish this submission");
}
