import type { MediaActor } from "#application/auth.ts";
import { MediaError, requireOwner } from "#application/errors.ts";
import type { MediaApplication } from "#application/ports.ts";
import { PrismaMediaCommands } from "./commands.ts";
import type { MediaCommandSettings } from "./command-base.ts";
import type { Database } from "./database.ts";
import {
  RequestListSchema,
  OperationListSchema,
  RemovalListSchema,
  NotificationListSchema,
  ProfileListSchema,
  UserListSchema,
  MediaDetailSchema,
} from "#shared/api.ts";
import { ReleaseListSchema } from "#shared/api.ts";
import {
  visibilityReader,
  publicAssetProperties,
  scopedRemovalConfirmation,
  visibilityAncestry,
  type VisibilitySections,
} from "./visibility/access.ts";
import { mediaVisibility } from "./visibility/detail.ts";
import { effectiveRequestWhere } from "./request-claims.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { currentSubtitlePolicies, policyStatus } from "./subtitle-policy.ts";
import { OwnerHealthSchema } from "#shared/notification-authority.ts";

export class PrismaMediaApplication
  extends PrismaMediaCommands
  implements MediaApplication
{
  constructor(
    private readonly db: Database,
    settings: MediaCommandSettings & {
      visibilitySections?: VisibilitySections;
    },
  ) {
    super(db, settings);
    this.visibilitySections = settings.visibilitySections;
  }
  private readonly visibilitySections: VisibilitySections | undefined;

  async listRequests(actor: MediaActor) {
    return RequestListSchema.parse(
      await this.db.mediaRequest.findMany({
        where: actor.role === "owner" ? {} : { userId: actor.id },
        include: { media: true },
        orderBy: { updatedAt: "desc" },
        take: 200,
      }),
    );
  }

  async getMedia(actor: MediaActor, mediaId: string) {
    return this.db.$transaction(async (tx) => {
      const reader = await visibilityReader(tx, actor, {
        serverMachineId: this.settings.serverMachineId,
        sections: this.visibilitySections,
      });
      const item = await tx.mediaItem.findUnique({
        where: { id: mediaId },
        include: {
          ...visibilityAncestry,
          children: {
            include: visibilityAncestry,
            orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
            take: 1000,
          },
          intent: true,
          requests: {
            where: {
              ...effectiveRequestWhere,
              ...(reader.owner ? {} : { userId: actor.id }),
            },
            select: {
              id: true,
              userId: true,
              subtitleLanguages: true,
              version: true,
              user: { select: { displayName: true } },
            },
          },
          holds: {
            where: reader.owner ? {} : { userId: actor.id },
            select: { id: true, userId: true, until: true, isPin: true },
          },
          retention: {
            where: { state: { notIn: ["cancelled", "purged"] } },
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              state: true,
              graceUntil: true,
              purgeAfter: true,
              version: true,
            },
          },
          watchStates: {
            where: reader.owner ? {} : { userId: actor.id },
            select: { userId: true, watched: true, observedAt: true },
          },
          assets: {
            select: {
              current: true,
              edition: true,
              asset: {
                select: {
                  id: true,
                  checksum: true,
                  version: true,
                  owned: true,
                  ownershipEpoch: true,
                  properties: true,
                  state: true,
                  createdAt: true,
                  subtitles: true,
                },
              },
            },
          },
        },
      });
      if (!item)
        throw new MediaError(
          "media_not_found",
          "Media item does not exist",
          404,
        );
      if (!reader.visible(item))
        throw new MediaError(
          "plex_library_access_required",
          "This title is outside your current library access",
          403,
        );
      const events = await tx.applicationEvent.findMany({
        where: {
          mediaId,
          ...(reader.owner
            ? {}
            : { OR: [{ actorId: actor.id }, { actorId: null }] }),
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { id: true, kind: true, createdAt: true },
      });
      const runtime = await tx.mediaRuntimeState.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      const policies = await currentSubtitlePolicies(tx, [mediaId]);
      return MediaDetailSchema.parse({
        ...item,
        children: item.children.filter((child) => reader.visible(child)),
        visibility: await mediaVisibility(tx, {
          media: item,
          userId: actor.id,
          owner: reader.owner,
          epoch: runtime.recoveryEpoch,
          visible: reader.visible,
        }),
        subtitlePolicies: policies,
        assets: item.assets.map((coverage) => ({
          ...coverage,
          asset: {
            ...coverage.asset,
            properties: publicAssetProperties(coverage.asset.properties),
            subtitleStatus: policyStatus({
              policy: policies[0],
              asset: coverage.asset,
              epoch: runtime.recoveryEpoch,
            }),
            subtitles: coverage.asset.subtitles.map((subtitle) => ({
              ...subtitle,
              accepted: subtitleAccepted({
                subtitle,
                asset: coverage.asset,
                epoch: runtime.recoveryEpoch,
              }),
            })),
          },
        })),
        events,
        ...(reader.owner
          ? await scopedRemovalConfirmation(tx, mediaId, reader.visible)
          : {}),
      });
    });
  }

  async activity(actor: MediaActor) {
    const operations = await this.db.operation.findMany({
      where: actor.role === "owner" ? {} : { userId: actor.id },
      orderBy: { updatedAt: "desc" },
      take: 100,
      select: {
        id: true,
        kind: true,
        targetId: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    const mediaTargets = operations.filter((operation) =>
      [
        "reconcile_media",
        "acquire_release",
        "restore_media",
        "retain_media",
        "acquire_subtitles",
        "refresh_catalog",
        "expand_catalog_requests",
      ].includes(operation.kind),
    );
    const media = await this.db.mediaItem.findMany({
      where: {
        id: {
          in: mediaTargets.flatMap((operation) =>
            operation.targetId === null ? [] : [operation.targetId],
          ),
        },
      },
      select: { id: true },
    });
    const ids = new Set(media.map((item) => item.id));
    return OperationListSchema.parse(
      operations.map((operation) => ({
        ...operation,
        mediaId:
          mediaTargets.includes(operation) &&
          operation.targetId !== null &&
          ids.has(operation.targetId)
            ? operation.targetId
            : null,
      })),
    );
  }

  async removals(actor: MediaActor) {
    return RemovalListSchema.parse(
      await this.db.retentionDecision.findMany({
        where: {
          state: { in: ["warning_pending", "grace_period", "quarantined"] },
          ...(actor.role === "owner"
            ? {}
            : {
                media: {
                  requests: { some: { userId: actor.id, active: true } },
                },
              }),
        },
        select: {
          id: true,
          mediaId: true,
          state: true,
          graceUntil: true,
          purgeAfter: true,
          media: { select: { title: true, kind: true, version: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
    );
  }

  async notifications(actor: MediaActor) {
    const runtime = await this.db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const deliveries = await this.db.notificationDelivery.findMany({
      where: { userId: actor.id },
      select: {
        id: true,
        channel: true,
        state: true,
        version: true,
        failureReason: true,
        providerStatus: true,
        attempts: true,
        acceptedAt: true,
        createdAt: true,
        event: { select: { mediaId: true, kind: true, payload: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return NotificationListSchema.parse(
      deliveries.map(({ event, ...delivery }) => {
        const proof =
          event.kind === "owner_health"
            ? OwnerHealthSchema.safeParse(event.payload)
            : null;
        return {
          ...delivery,
          event: {
            mediaId: event.mediaId,
            kind: event.kind,
            ...(proof === null
              ? {}
              : proof.success
                ? {
                    healthReason: proof.data.reason,
                    healthState:
                      runtime.recoveryEpoch === proof.data.recoveryEpoch &&
                      runtime.version === proof.data.runtimeVersion &&
                      runtime.mode === "observe" &&
                      !runtime.ownershipConfirmed
                        ? "current"
                        : "superseded",
                  }
                : { healthState: "invalid" }),
          },
        };
      }),
    );
  }

  async profiles(_actor: MediaActor) {
    return ProfileListSchema.parse(
      await this.db.qualityProfile.findMany({ orderBy: { name: "asc" } }),
    );
  }
  async profileDefaults(_actor: MediaActor) {
    return ProfileDefaultsSchema.parse(
      await this.db.qualityProfileDefault.findMany({
        orderBy: { kind: "asc" },
      }),
    );
  }

  async identityPreview(
    actor: MediaActor,
    mediaId: string,
    releaseId: string,
    input: IdentityPreviewInput,
  ) {
    return this.db.$transaction(
      async (tx) => {
        await lockAcquisitionMedia(tx, input.mediaIds);
        await lockEffectiveRequests(tx, input.mediaIds);
        await commandAutomationEpoch(tx);
        return buildIdentityPreview(tx, actor, {
          ...input,
          mediaId,
          releaseId,
          ...this.settings,
        });
      },
      { isolationLevel: "Serializable" },
    );
  }

  async releases(actor: MediaActor, mediaId: string) {
    await this.db.$transaction(async (tx) => {
      await lockAcquisitionMedia(tx, [mediaId]);
      await lockEffectiveRequests(tx, [mediaId]);
      await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
      await authorizeRenewal(tx, actor, {
        mediaId,
        action: "retry",
        ...this.settings,
      });
    });
    return ReleaseListSchema.parse(
      await this.db.releaseCandidate.findMany({
        where: {
          OR: [
            { mediaIds: { has: mediaId } },
            { searchedForMediaIds: { has: mediaId } },
          ],
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          providerId: true,
          title: true,
          attributes: true,
          evaluation: true,
          createdAt: true,
        },
      }),
    );
  }

  async listUsers(actor: MediaActor) {
    requireOwner(actor);
    return UserListSchema.parse(
      await this.db.mediaUser.findMany({
        select: {
          id: true,
          displayName: true,
          plexAccountId: true,
          role: true,
          restricted: true,
          version: true,
        },
        orderBy: { displayName: "asc" },
      }),
    );
  }
}
import { ProfileDefaultsSchema } from "#shared/api.ts";
import type { IdentityPreviewInput } from "#shared/acquisition/preview.ts";
import { buildIdentityPreview } from "./acquisition-identity/preview.ts";
import { lockAcquisitionMedia } from "./acquisition-identity/locks.ts";
import { lockEffectiveRequests } from "./request-claims.ts";
import { commandAutomationEpoch } from "./handoff/authority.ts";
import { authorizeRenewal } from "./action-guards.ts";
