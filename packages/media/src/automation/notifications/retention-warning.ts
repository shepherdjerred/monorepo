import type { Prisma } from "#generated/prisma/client.ts";
import { queueOperation } from "#automation/store.ts";
import { captureRetentionPlexProjection } from "#infrastructure/plex-binding/retention.ts";
import type {
  PlexBindingSnapshot,
  PlexPhysicalGroup,
} from "#shared/plex-binding/contract.ts";
import type {
  MovieEditionScope,
  MovieEditionKey,
} from "#shared/movie-editions/registry.ts";
import { defaultIntent } from "#shared/editions/scope.ts";
import { MovieRetentionWarningV4Schema } from "#shared/movie-editions/retention-v4.ts";
import type { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";

type WarningDecision = Prisma.RetentionDecisionGetPayload<{
  include: { media: { include: { intents: true; holds: true } } };
}>;

/** Delivery rechecks current intent, pending state and holds after its durable claim. */
export function retentionWarningCurrent(
  decision: WarningDecision,
  expected: {
    mediaId: string | null;
    edition: MovieEditionKey;
    generation: number;
    epoch: number;
  },
): boolean {
  if (
    decision.mediaId !== expected.mediaId ||
    decision.edition !== expected.edition
  )
    return false;
  const intent =
    expected.edition === "default"
      ? defaultIntent(decision.media.intents)
      : decision.media.intents.find(
          (target) => target.edition === expected.edition,
        );
  return (
    decision.generation === expected.generation &&
    intent?.generation === expected.generation &&
    intent.automationEpoch === expected.epoch &&
    ["warning_pending", "grace_period"].includes(decision.state) &&
    !decision.media.holds.some(
      (hold) => hold.isPin || hold.until === null || hold.until > new Date(),
    )
  );
}

export async function createWarning(
  tx: Prisma.TransactionClient,
  item: {
    id: string;
    requests: Prisma.MediaRequestGetPayload<{
      include: { user: { include: { notificationPreference: true } } };
    }>[];
  },
  authority: {
    generation: number;
    epoch: number;
    scope?: MovieEditionScope;
    budget?: PublicationAuthorityReadBudget;
    binding: {
      groups: readonly PlexPhysicalGroup[];
      bindings: readonly PlexBindingSnapshot[];
    };
  },
) {
  const { generation, epoch, binding, scope } = authority;
  if (
    scope !== undefined &&
    (scope.mediaId !== item.id ||
      scope.rootMediaId !== item.id ||
      binding.bindings.length !== 1 ||
      binding.bindings[0]?.scope.edition !== scope.edition ||
      item.requests.some((request) => request.edition !== scope.edition))
  )
    throw new Error(
      "Scoped retention warning differs from its selected movie cohort",
    );
  const decisionId = crypto.randomUUID();
  await tx.retentionDecision.create({
    data: {
      id: decisionId,
      mediaId: item.id,
      generation,
      edition: scope?.edition ?? "default",
      state: "eligible",
      evidence: { recoveryEpoch: epoch },
    },
  });
  await captureRetentionPlexProjection(
    tx,
    { decisionId, ...binding },
    authority.budget,
  );
  const event = await tx.applicationEvent.create({
    data: {
      mediaId: item.id,
      kind: "retention_warning",
      payload:
        scope === undefined
          ? { decisionId, generation }
          : MovieRetentionWarningV4Schema.parse({
              schemaVersion: 4,
              kind: "movie_retention_warning",
              scope,
              decisionId,
              generation,
              recoveryEpoch: epoch,
            }),
    },
  });
  const decision = await tx.retentionDecision.update({
    where: { id: decisionId },
    data: {
      state: "warning_pending",
      version: { increment: 1 },
      evidence: { warningEventId: event.id, recoveryEpoch: epoch },
    },
  });
  for (const claim of item.requests.filter(
    (request) => request.user.role !== "owner",
  )) {
    const preference = claim.user.notificationPreference;
    const channels = [
      preference?.emailEnabled === true &&
      claim.user.emailVerifiedAt !== null &&
      claim.user.email !== null
        ? "email"
        : null,
      preference?.discordEnabled === true && claim.user.discordId !== null
        ? "discord"
        : null,
    ].filter((channel) => channel !== null);
    for (const channel of channels) {
      const notification = await tx.notificationDelivery.create({
        data: {
          eventId: event.id,
          userId: claim.userId,
          channel,
          state: "pending",
          recoveryEpoch: epoch,
        },
      });
      await queueOperation(tx, {
        key: `notification:${notification.id}`,
        kind: "deliver_notification",
        targetId: notification.id,
        userId: claim.userId,
        payload: { notificationId: notification.id },
      });
    }
  }
  return decision;
}
