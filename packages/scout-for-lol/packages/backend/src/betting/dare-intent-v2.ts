import {
  DareIntentPayloadSchema,
  DiscordGuildIdSchema,
  type DareIntentKind,
  type DareIntentPayload,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";
import {
  defaultDareV2Dependencies,
  relationalDareActionEnabled,
  type DareV2Dependencies,
} from "#src/betting/dare-v2-common.ts";
import { DARE_V2_INTENT_TTL_MS } from "#src/betting/constants.ts";
import { createConfirmationIntent } from "#src/lib/confirmation-intent/create.ts";

/**
 * The bare action behind a dare confirmation kind.
 *
 * Storage and the shared protocol speak the prefixed kind, but the word a
 * person reads — in the Discord confirmation, in the web confirmation card, in
 * the Explore tool result — has always been the bare action, so the two views
 * are mapped rather than merged.
 */
const DARE_ACTION_BY_KIND = {
  dare_fund: "fund",
  dare_accept: "accept",
  dare_decline: "decline",
  dare_contribute: "contribute",
  dare_cancel: "cancel",
} as const satisfies Record<DareIntentKind, string>;

type DareV2IntentAction = (typeof DARE_ACTION_BY_KIND)[DareIntentKind];

export function dareV2IntentAction(kind: DareIntentKind): DareV2IntentAction {
  return DARE_ACTION_BY_KIND[kind];
}

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

export async function createDareV2ConfirmationIntent(
  input: {
    dareId: number;
    serverId: DiscordGuildId;
    actorDiscordId: DiscordAccountId;
    expectedRevision: number;
    payload: DareIntentPayload;
    idempotencyKey: string;
  },
  dependencies: DareV2Dependencies = defaultDareV2Dependencies,
  now: Date = new Date(),
) {
  const payload = DareIntentPayloadSchema.parse(input.payload);
  const action = dareV2IntentAction(payload.kind);
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
  if (!actorAuthorized(action, input.actorDiscordId, dare)) {
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
    actionNeedsFeature(action) &&
    !(await relationalDareActionEnabled(
      input.serverId,
      revision.compilerVersion,
      action === "fund",
      dependencies,
    ))
  ) {
    return { kind: "feature_disabled" } as const;
  }
  const applicableRevision = dare.fundedRevision ?? dare.currentRevision;
  if (
    applicableRevision !== input.expectedRevision ||
    (action === "fund" && dare.dareState !== "draft")
  ) {
    return {
      kind: "stale_revision",
      currentRevision: applicableRevision,
    } as const;
  }
  const created = await createConfirmationIntent(dependencies.prismaClient, {
    // Taken from the dare, never from the caller: the stored guild is what
    // every later visibility check compares against.
    serverId: DiscordGuildIdSchema.parse(dare.serverId),
    actorDiscordId: input.actorDiscordId,
    payload,
    idempotencyKey: input.idempotencyKey,
    expiresAt: new Date(now.getTime() + DARE_V2_INTENT_TTL_MS),
    dareId: dare.id,
    expectedRevision: input.expectedRevision,
  });
  if (created.kind === "idempotency_conflict") {
    return { kind: "idempotency_conflict" } as const;
  }
  return {
    kind: "intent_created",
    intentId: created.intent.id,
    expiresAt: created.intent.expiresAt,
    action,
  } as const;
}
