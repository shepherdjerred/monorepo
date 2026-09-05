import {
  ConfirmationIntentPayloadSchema,
  DiscordAccountIdSchema,
  DiscordGuildIdSchema,
  type ConfirmationIntentPayload,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import { z } from "zod";
import type { ConfirmationIntent } from "#generated/prisma/client/index.js";
import type { ExtendedPrismaClient } from "#src/database/index.ts";

const UniqueViolationSchema = z.object({ code: z.literal("P2002") });

export type CreateConfirmationIntentInput = {
  /**
   * The guild the intent belongs to. Every later visibility check compares
   * this column, so it must be read off the row being acted on rather than
   * taken from whoever asked for the intent.
   */
  serverId: DiscordGuildId;
  actorDiscordId: DiscordAccountId;
  payload: ConfirmationIntentPayload;
  idempotencyKey: string;
  expiresAt: Date;
  /** Set only by intents that act on an existing dare. */
  dareId?: number | undefined;
  /** The dare revision the actor saw, for staleness detection. */
  expectedRevision?: number | undefined;
};

export type CreateConfirmationIntentResult =
  | { kind: "intent_created"; intent: ConfirmationIntent }
  | { kind: "idempotency_conflict" };

async function createOrRead(
  prismaClient: ExtendedPrismaClient,
  data: Parameters<
    ExtendedPrismaClient["confirmationIntent"]["create"]
  >[0]["data"],
  idempotencyKey: string,
): Promise<ConfirmationIntent> {
  try {
    return await prismaClient.confirmationIntent.create({ data });
  } catch (error) {
    if (!UniqueViolationSchema.safeParse(error).success) throw error;
    return await prismaClient.confirmationIntent.findUniqueOrThrow({
      where: { idempotencyKey },
    });
  }
}

/**
 * Mints an intent, or returns the one an earlier identical request already
 * minted.
 *
 * A retry with the same idempotency key must be a no-op, but a *different*
 * request reusing someone's key must not silently inherit their intent — so
 * the row that comes back is compared field by field against what was asked
 * for, and a mismatch is reported rather than confirmed.
 */
export async function createConfirmationIntent(
  prismaClient: ExtendedPrismaClient,
  input: CreateConfirmationIntentInput,
): Promise<CreateConfirmationIntentResult> {
  const payload = ConfirmationIntentPayloadSchema.parse(input.payload);
  const serialized = JSON.stringify(payload);
  const data = {
    kind: payload.kind,
    serverId: DiscordGuildIdSchema.parse(input.serverId),
    actorDiscordId: DiscordAccountIdSchema.parse(input.actorDiscordId),
    payload: serialized,
    idempotencyKey: input.idempotencyKey,
    expiresAt: input.expiresAt,
    dareId: input.dareId ?? null,
    expectedRevision: input.expectedRevision ?? null,
  };
  const intent = await createOrRead(prismaClient, data, input.idempotencyKey);
  if (
    intent.kind !== data.kind ||
    intent.serverId !== data.serverId ||
    intent.actorDiscordId !== data.actorDiscordId ||
    intent.payload !== data.payload ||
    intent.dareId !== data.dareId ||
    intent.expectedRevision !== data.expectedRevision
  ) {
    return { kind: "idempotency_conflict" };
  }
  return { kind: "intent_created", intent };
}
