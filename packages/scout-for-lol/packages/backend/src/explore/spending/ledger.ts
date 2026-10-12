import { getPricing } from "@shepherdjerred/llm-models";
import { prisma, type Db } from "#src/database/index.ts";
import { z } from "zod";
import { DiscordAccountIdSchema } from "@scout-for-lol/data";
import { EXPLORE_MAX_PROVIDER_INPUT_BOUND } from "./input-bound.ts";

import {
  ExploreSpendPolicySchema,
  DEFAULT_EXPLORE_SPEND_POLICY,
} from "#src/configuration/explore-spend.ts";

export class ExploreBudgetError extends Error {
  constructor(
    message = "Explore's spending allowance is exhausted. Try Luna, a narrower question, or wait for the allowance to reset.",
  ) {
    super(message);
    this.name = "ExploreBudgetError";
  }
}

export function pricingForExplore(model: string) {
  const pricing = z
    .object({
      modality: z.literal("text"),
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cachedInput: z.number().nonnegative().optional(),
      cacheWrite: z.number().nonnegative().optional(),
    })
    .parse(getPricing(model));
  return {
    input: pricing.input,
    cachedInput: pricing.cachedInput ?? pricing.input,
    cacheWrite: pricing.cacheWrite ?? pricing.input,
    output: pricing.output,
  };
}

async function used(
  database: Pick<Db, "exploreSpend">,
  where: { month?: string; ownerId?: string; runId?: string },
) {
  const result = await database.exploreSpend.aggregate({
    where: {
      ...(where.month === undefined ? {} : { month: where.month }),
      ...(where.runId === undefined ? {} : { runId: where.runId }),
      ...(where.ownerId === undefined
        ? {}
        : { ownerId: DiscordAccountIdSchema.parse(where.ownerId) }),
    },
    _sum: { budgetMicros: true },
  });
  return result._sum.budgetMicros ?? 0;
}

export async function exploreSpendingStatus(
  ownerId: string,
  policy = DEFAULT_EXPLORE_SPEND_POLICY,
  now = new Date(),
) {
  const month = now.toISOString().slice(0, 7);
  const [global, user] = await Promise.all([
    used(prisma, { month }),
    used(prisma, { month, ownerId }),
  ]);
  return {
    month,
    globalUsedMicros: global,
    userUsedMicros: user,
    globalRemainingMicros: Math.max(0, policy.globalMonthlyMicros - global),
    userRemainingMicros: Math.max(0, policy.userMonthlyMicros - user),
    resetsAt: new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    ).toISOString(),
  };
}

export async function reserveExploreCall(
  input: {
    ownerId: string;
    runId: string;
    model: string;
    inputBound: number;
    maxOutputTokens: number;
    policy?: z.infer<typeof ExploreSpendPolicySchema>;
    now?: Date;
  },
  database = prisma,
) {
  const policy = ExploreSpendPolicySchema.parse(
    input.policy ?? DEFAULT_EXPLORE_SPEND_POLICY,
  );
  const rates = pricingForExplore(input.model);
  const month = (input.now ?? new Date()).toISOString().slice(0, 7);
  if (!Number.isSafeInteger(input.maxOutputTokens) || input.maxOutputTokens < 1)
    throw new Error("Invalid provider output token limit");
  if (
    !Number.isSafeInteger(input.inputBound) ||
    input.inputBound < 0 ||
    input.inputBound > EXPLORE_MAX_PROVIDER_INPUT_BOUND
  )
    throw new ExploreBudgetError(
      "This question exceeds Explore's input limit. Start a new conversation or select smaller datasets.",
    );
  return await database.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('scout-explore-spend'))`;
    const [global, user, turn] = await Promise.all([
      used(tx, { month }),
      used(tx, { month, ownerId: input.ownerId }),
      used(tx, { runId: input.runId }),
    ]);
    const remaining = Math.min(
      policy.globalMonthlyMicros - global,
      policy.userMonthlyMicros - user,
      policy.turnMicros - turn,
    );
    // USD/M tokens is numerically microdollars/token. Reserve cache-write at
    // its higher rate, and output inclusive of hidden reasoning tokens.
    const inputMicros = Math.ceil(
      input.inputBound *
        Math.max(rates.input, rates.cachedInput, rates.cacheWrite),
    );
    const maxOutputTokens = Math.min(
      32_768,
      input.maxOutputTokens,
      Math.floor((remaining - inputMicros) / rates.output),
    );
    if (maxOutputTokens < 256) throw new ExploreBudgetError();
    const amount = Math.ceil(inputMicros + maxOutputTokens * rates.output);
    const row = await tx.exploreSpend.create({
      data: {
        runId: input.runId,
        ownerId: DiscordAccountIdSchema.parse(input.ownerId),
        model: input.model,
        month,
        reservedMicros: amount,
        budgetMicros: amount,
      },
    });
    return { id: row.id, maxOutputTokens, amount, rates };
  });
}

const UsageSchema = z.looseObject({
  inputTokens: z.looseObject({
    total: z.number().int().nonnegative(),
    noCache: z.number().int().nonnegative().nullish(),
    cacheRead: z.number().int().nonnegative().nullish(),
    cacheWrite: z.number().int().nonnegative().nullish(),
  }),
  outputTokens: z.looseObject({ total: z.number().int().nonnegative() }),
});

export async function settleExploreCall(
  reservation: Awaited<ReturnType<typeof reserveExploreCall>>,
  usage: unknown,
  responseId?: string,
  database = prisma,
) {
  const parsed = UsageSchema.safeParse(usage);
  if (!parsed.success) return; // Uncertain billing keeps the durable maximum hold.
  const { inputTokens, outputTokens } = parsed.data;
  const rates = reservation.rates;
  const cached = inputTokens.cacheRead ?? 0,
    written = inputTokens.cacheWrite ?? 0;
  if (cached + written > inputTokens.total)
    throw new Error("Provider usage cache counts exceed total input");
  const uncached = inputTokens.total - cached - written;
  const cost = Math.ceil(
    uncached * rates.input +
      cached * rates.cachedInput +
      written * rates.cacheWrite +
      outputTokens.total * rates.output,
  );
  await database.exploreSpend.updateMany({
    where: { id: reservation.id, state: "held" },
    data: {
      state: "settled",
      budgetMicros: cost,
      usage: JSON.stringify(parsed.data),
      settledAt: new Date(),
      ...(responseId === undefined ? {} : { responseId }),
    },
  });
  if (cost > reservation.amount)
    throw new Error("Provider usage exceeded its reserved maximum cost");
}
