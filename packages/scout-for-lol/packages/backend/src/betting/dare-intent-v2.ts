import {
  BucksStakeSchema,
  DiscordAccountIdSchema,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { z } from "zod";
import {
  defaultDareV2Dependencies,
  relationalDareActionEnabled,
  type DareV2Dependencies,
} from "#src/betting/dare-v2-common.ts";
import { DARE_V2_INTENT_TTL_MS } from "#src/betting/constants.ts";

const UniqueViolationSchema = z.object({ code: z.literal("P2002") });

export const DareV2IntentActionSchema = z.enum([
  "fund",
  "accept",
  "decline",
  "contribute",
  "cancel",
]);
export type DareV2IntentAction = z.infer<typeof DareV2IntentActionSchema>;

export const DareV2IntentPayloadSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("fund") }),
  z.strictObject({ action: z.literal("accept") }),
  z.strictObject({ action: z.literal("decline") }),
  z.strictObject({
    action: z.literal("contribute"),
    amount: BucksStakeSchema,
  }),
  z.strictObject({ action: z.literal("cancel") }),
]);
export type DareV2IntentPayload = z.infer<typeof DareV2IntentPayloadSchema>;

function actionNeedsFeature(action: DareV2IntentAction): boolean {
  return action === "fund" || action === "accept" || action === "contribute";
}

function actorAuthorized(
  action: DareV2IntentAction,
  actor: DiscordAccountId,
  dare: {
    challengerDiscordId: string;
    targets: readonly { discordId: string }[];
  },
): boolean {
  const target = dare.targets.some((row) => row.discordId === actor);
  if (action === "fund" || action === "cancel") {
    return dare.challengerDiscordId === actor;
  }
  if (action === "accept" || action === "decline") return target;
  return !target;
}

async function createOrReadConfirmationIntent(
  input: Parameters<
    DareV2Dependencies["prismaClient"]["bucksDareV2ConfirmationIntent"]["create"]
  >[0],
  idempotencyKey: string,
  dependencies: DareV2Dependencies,
) {
  try {
    return await dependencies.prismaClient.bucksDareV2ConfirmationIntent.create(
      input,
    );
  } catch (error) {
    if (!UniqueViolationSchema.safeParse(error).success) throw error;
    return await dependencies.prismaClient.bucksDareV2ConfirmationIntent.findUniqueOrThrow(
      { where: { idempotencyKey } },
    );
  }
}

export async function createDareV2ConfirmationIntent(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    actorDiscordId: DiscordAccountId;
    expectedRevision: number;
    payload: DareV2IntentPayload;
    idempotencyKey: string;
  },
  dependencies: DareV2Dependencies = defaultDareV2Dependencies,
  now: Date = new Date(),
) {
  const payload = DareV2IntentPayloadSchema.parse(input.payload);
  const dare = await dependencies.prismaClient.bucksDareV2.findUnique({
    where: { id: input.dareId },
    include: {
      targets: { select: { discordId: true } },
      revisions: {
        where: { revision: input.expectedRevision },
        select: { compilerVersion: true },
        take: 1,
      },
    },
  });
  if (dare?.serverId !== input.serverId) {
    return { kind: "not_found" } as const;
  }
  if (!actorAuthorized(payload.action, input.actorDiscordId, dare)) {
    return { kind: "forbidden" } as const;
  }
  const revision = dare.revisions[0];
  if (revision === undefined) {
    return {
      kind: "stale_revision",
      currentRevision: dare.currentRevision,
    } as const;
  }
  if (
    actionNeedsFeature(payload.action) &&
    !(await relationalDareActionEnabled(
      input.serverId,
      revision.compilerVersion,
      dependencies,
    ))
  ) {
    return { kind: "feature_disabled" } as const;
  }
  const applicableRevision = dare.fundedRevision ?? dare.currentRevision;
  if (
    applicableRevision !== input.expectedRevision ||
    (payload.action === "fund" && dare.dareState !== "draft")
  ) {
    return {
      kind: "stale_revision",
      currentRevision: applicableRevision,
    } as const;
  }
  const expiresAt = new Date(now.getTime() + DARE_V2_INTENT_TTL_MS);
  const actionPayload = JSON.stringify(payload);
  const created = await createOrReadConfirmationIntent(
    {
      data: {
        dareId: dare.id,
        revision: input.expectedRevision,
        actorDiscordId: DiscordAccountIdSchema.parse(input.actorDiscordId),
        action: payload.action,
        actionPayload,
        idempotencyKey: input.idempotencyKey,
        expiresAt,
      },
    },
    input.idempotencyKey,
    dependencies,
  );
  if (
    created.dareId !== dare.id ||
    created.actorDiscordId !== input.actorDiscordId ||
    created.action !== payload.action ||
    created.actionPayload !== actionPayload ||
    created.revision !== input.expectedRevision
  ) {
    return { kind: "idempotency_conflict" } as const;
  }
  return {
    kind: "intent_created",
    intentId: created.id,
    expiresAt: created.expiresAt,
    action: payload.action,
  } as const;
}
