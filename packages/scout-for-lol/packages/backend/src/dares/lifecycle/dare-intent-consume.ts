import type { ConfirmationIntent } from "#generated/prisma/client/index.js";
import {
  defaultDareDependencies,
  relationalDareActionEnabled,
  type DareDependencies,
} from "#src/dares/dare-common.ts";
import {
  cancelDareInTransaction,
  declineDareInTransaction,
} from "#src/dares/lifecycle/dare-end-consent.ts";
import {
  acceptDareInTransaction,
  publishDareInTransaction,
} from "#src/dares/lifecycle/dare-publish-consent.ts";
import type { Db } from "#src/database/index.ts";
import { claimAndExecute } from "#src/lib/confirmation-intent/claim.ts";
import { readConfirmationIntentPayload } from "#src/lib/confirmation-intent/payload.ts";
import {
  type ConfirmationIntentPayload,
  type DareIntentPayload,
  type DiscordAccountId,
  type DiscordGuildId,
} from "@scout-for-lol/data";

/** The dare an intent acts on, together with the revision it was minted for. */
type DareIntentTarget = { dareId: number; revision: number };

function asDarePayload(
  payload: ConfirmationIntentPayload,
): DareIntentPayload | null {
  switch (payload.kind) {
    case "dare_publish":
    case "dare_accept":
    case "dare_decline":
    case "dare_cancel": {
      return payload;
    }
    case "report":
    case "subscription":
    case "competition":
    case "ops_reconcile_pipeline":
    case "ops_retry_notification":
    case "ops_suppress_stale_notification":
    case "ops_resolve_unknown_delivery":
    case "ops_resolve_report_delivery":
    case "ops_repair_projection":
    case "ops_release_recovery_policy": {
      return null;
    }
  }
}

function needsFeature(payload: DareIntentPayload): boolean {
  return payload.kind === "dare_publish" || payload.kind === "dare_accept";
}

/**
 * A dare intent always carries its dare and revision; the columns are nullable
 * only because an intent need not act on an existing row. Missing values here
 * mean a broken caller contract, so they are let through as an error rather
 * than defaulted.
 */
function dareTarget(intent: ConfirmationIntent): DareIntentTarget {
  if (intent.dareId === null || intent.expectedRevision === null) {
    throw new Error(
      `Confirmation intent ${intent.id} of kind ${intent.kind} has no dare target.`,
    );
  }
  return { dareId: intent.dareId, revision: intent.expectedRevision };
}

async function executeAction(
  tx: Db,
  input: {
    target: DareIntentTarget;
    actorDiscordId: DiscordAccountId;
    payload: DareIntentPayload;
    now: Date;
  },
) {
  const common = {
    dareId: input.target.dareId,
    revision: input.target.revision,
    actorDiscordId: input.actorDiscordId,
    now: input.now,
  };
  if (input.payload.kind === "dare_publish") {
    return await publishDareInTransaction(tx, {
      ...common,
    });
  }
  if (input.payload.kind === "dare_accept") {
    return await acceptDareInTransaction(tx, {
      ...common,
    });
  }
  return input.payload.kind === "dare_decline"
    ? await declineDareInTransaction(tx, common)
    : await cancelDareInTransaction(tx, common);
}

export async function consumeDareConfirmationIntent(
  input: {
    intentId: string;
    serverId: DiscordGuildId;
    actorDiscordId: DiscordAccountId;
  },
  dependencies: DareDependencies = defaultDareDependencies,
  now: Date = new Date(),
) {
  const intent = await dependencies.prismaClient.confirmationIntent.findUnique({
    where: { id: input.intentId },
  });
  // The guild is stored on the intent, so this is the same check the join
  // through `dare.serverId` used to make.
  if (intent?.serverId !== input.serverId) {
    return { kind: "not_found" } as const;
  }
  if (intent.actorDiscordId !== input.actorDiscordId) {
    return { kind: "forbidden" } as const;
  }
  const payload = asDarePayload(readConfirmationIntentPayload(intent));
  if (payload === null) {
    return { kind: "not_found" } as const;
  }
  if (intent.consumedAt !== null) {
    return {
      kind: "already_consumed",
      result: intent.resultJson === null ? null : JSON.parse(intent.resultJson),
    } as const;
  }
  if (intent.expiresAt.getTime() <= now.getTime()) {
    return { kind: "intent_expired" } as const;
  }
  const target = dareTarget(intent);
  if (
    needsFeature(payload) &&
    !(await relationalDareActionEnabled(
      input.serverId,
      payload.kind === "dare_publish",
      dependencies,
    ))
  ) {
    return { kind: "feature_disabled" } as const;
  }
  return await claimAndExecute(
    dependencies.prismaClient,
    {
      intentId: intent.id,
      actorDiscordId: input.actorDiscordId,
      now,
    },
    async (tx) =>
      await executeAction(tx, {
        target,
        actorDiscordId: input.actorDiscordId,
        payload,
        now,
      }),
  );
}
