import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import {
  DEFAULT_TARGET_UNAVAILABLE,
  DefaultTargetBatchSchema,
  type DefaultTargetBatch,
} from "#shared/editions/target-batch.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import {
  assessVisibilityAccess,
  visibilityAncestry,
  type VisibilitySections,
} from "#infrastructure/visibility/access.ts";
import { leavingSoonIds } from "#infrastructure/library/views/leaving-hold.ts";
import { canonicalRootId } from "./locks.ts";

type ContextSettings = {
  serverMachineId?: string | undefined;
  sections?: VisibilitySections | undefined;
};

/** The single-title read is the batch read of one id, so the two cannot drift. */
export async function readDefaultCommandContext(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  mediaId: string,
  settings: ContextSettings,
): Promise<DefaultTargetView> {
  const batch = await readDefaultCommandContexts(
    tx,
    actor,
    [mediaId],
    settings,
  );
  const [item] = batch.items;
  if (item === undefined)
    throw new Error("Default command context read returned no item");
  if (item.status === "ok") return item.view;
  const failure = DEFAULT_TARGET_UNAVAILABLE[item.code];
  throw new MediaError(item.code, failure.message, failure.status);
}

/** Reads every id with the same fixed set of queries, in the caller's
 * transaction. Repeated ids collapse; items follow first-seen request order. */
export async function readDefaultCommandContexts(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  mediaIds: readonly string[],
  settings: ContextSettings,
): Promise<DefaultTargetBatch> {
  const ids = [...new Set(mediaIds)];
  const access = await assessVisibilityAccess(tx, actor, settings);
  const items = await tx.mediaItem.findMany({
    where: { id: { in: ids } },
    include: visibilityAncestry,
  });
  const media = new Map(items.map((item) => [item.id, item]));
  const ownRequests = await tx.mediaRequest.findMany({
    where: { userId: actor.id, mediaId: { in: ids }, edition: "default" },
    select: { id: true, version: true, active: true, mediaId: true },
  });
  const effectiveRequests = await tx.mediaRequest.findMany({
    where: { ...effectiveRequestWhere, userId: actor.id, mediaId: { in: ids } },
    select: { mediaId: true },
  });
  const effective = new Set(
    effectiveRequests.map((request) => request.mediaId),
  );
  const owner = access.user.role === "owner";
  const facts = new Map(
    ids.flatMap((id) => {
      const item = media.get(id);
      if (item === undefined) return [];
      const own = ownRequests.filter((request) => request.mediaId === id);
      const detail = access.reader?.visible(item) === true;
      const authorized = effective.has(id) || detail || owner || own.length > 0;
      return [[id, { item, own, detail, authorized }] as const];
    }),
  );
  // Always asked, for every title the actor can see, so the read issues the
  // same statements whoever asks and however many titles they ask about.
  const leaving = await leavingSoonIds(
    tx,
    ids.filter((id) => facts.get(id)?.detail === true),
  );
  const intents = await tx.mediaIntent.findMany({
    where: {
      edition: "default",
      mediaId: { in: ids.filter((id) => facts.get(id)?.authorized === true) },
    },
  });
  const targets = new Map(intents.map((target) => [target.mediaId, target]));
  return DefaultTargetBatchSchema.parse({
    schemaVersion: 2,
    items: ids.map((id) => {
      const fact = facts.get(id);
      if (fact === undefined)
        return { status: "unavailable", mediaId: id, code: "media_not_found" };
      if (!fact.authorized)
        return { status: "unavailable", mediaId: id, code: "forbidden" };
      const target = targets.get(id) ?? null;
      const common = {
        schemaVersion: 2,
        scope: defaultScope(id),
        expected: {
          mediaVersion: fact.item.version,
          targetVersion: target?.version ?? null,
        },
        ownRequests: fact.own.map((request) => ({
          id: request.id,
          version: request.version,
          active: request.active,
          canCancel: request.active,
        })),
        allowedProtectiveActions: protectiveActions({
          owner,
          // Anyone who can see a title that is leaving soon may hold it for
          // 30 days.
          mayKeep:
            owner || effective.has(id) || (fact.detail && leaving.has(id)),
          targetExists: target !== null,
          ownActiveRequest: fact.own.some((request) => request.active),
        }),
      };
      return {
        status: "ok",
        view: fact.detail
          ? {
              ...common,
              access: "detail",
              target:
                target === null
                  ? null
                  : {
                      generation: target.generation,
                      availability: target.availability,
                      lineage:
                        target.editionRootId !== null &&
                        target.editionRootId === canonicalRootId(fact.item)
                          ? "resolved"
                          : "unresolved",
                    },
            }
          : { ...common, access: "protection_only" },
      };
    }),
  });
}

function protectiveActions(input: {
  owner: boolean;
  mayKeep: boolean;
  targetExists: boolean;
  ownActiveRequest: boolean;
}) {
  return [
    ...(input.mayKeep ? ["keep"] : []),
    ...(input.owner ? ["pin", ...(input.targetExists ? ["unpin"] : [])] : []),
    ...((input.owner && input.targetExists) || input.ownActiveRequest
      ? ["cancel_request"]
      : []),
  ];
}
