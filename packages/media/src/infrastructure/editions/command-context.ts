import type { Prisma } from "#generated/prisma/client.ts";
import type { MediaActor } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import { DefaultTargetViewSchema } from "#shared/editions/target-view.ts";
import { defaultScope } from "#shared/editions/scope.ts";
import { effectiveRequestWhere } from "#infrastructure/request-claims.ts";
import {
  assessVisibilityAccess,
  visibilityAncestry,
  type VisibilitySections,
} from "#infrastructure/visibility/access.ts";
import { targetWhere } from "./targets.ts";
import { canonicalRootId } from "./locks.ts";

export async function readDefaultCommandContext(
  tx: Prisma.TransactionClient,
  actor: MediaActor,
  mediaId: string,
  settings: {
    serverMachineId?: string | undefined;
    sections?: VisibilitySections | undefined;
  },
) {
  const access = await assessVisibilityAccess(tx, actor, settings);
  const media = await tx.mediaItem.findUnique({
    where: { id: mediaId },
    include: visibilityAncestry,
  });
  if (media === null)
    throw new MediaError("media_not_found", "Media item does not exist", 404);
  const ownRequests = await tx.mediaRequest.findMany({
    where: { userId: actor.id, mediaId, edition: "default" },
    select: { id: true, version: true, active: true },
  });
  const effective = await tx.mediaRequest.count({
    where: { ...effectiveRequestWhere, userId: actor.id, mediaId },
  });
  const owner = access.user.role === "owner";
  const detail = access.reader?.visible(media) === true;
  if (effective === 0 && !detail && !owner && ownRequests.length === 0)
    throw new MediaError(
      "forbidden",
      "No authorized command context for this target",
      403,
    );
  const scope = defaultScope(mediaId);
  const target = await tx.mediaIntent.findUnique({ where: targetWhere(scope) });
  const common = {
    schemaVersion: 2,
    scope,
    expected: {
      mediaVersion: media.version,
      targetVersion: target?.version ?? null,
    },
    ownRequests: ownRequests.map((request) => ({
      ...request,
      canCancel: request.active,
    })),
    allowedProtectiveActions: protectiveActions({
      owner,
      effective: effective > 0,
      targetExists: target !== null,
      ownActiveRequest: ownRequests.some((request) => request.active),
    }),
  };
  return DefaultTargetViewSchema.parse(
    detail
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
                    target.editionRootId === canonicalRootId(media)
                      ? "resolved"
                      : "unresolved",
                },
        }
      : { ...common, access: "protection_only" },
  );
}

function protectiveActions(input: {
  owner: boolean;
  effective: boolean;
  targetExists: boolean;
  ownActiveRequest: boolean;
}) {
  return [
    ...(input.owner || input.effective ? ["keep"] : []),
    ...(input.owner ? ["pin", ...(input.targetExists ? ["unpin"] : [])] : []),
    ...((input.owner && input.targetExists) || input.ownActiveRequest
      ? ["cancel_request"]
      : []),
  ];
}
