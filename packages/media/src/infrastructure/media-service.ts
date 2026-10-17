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
import { removalConfirmation } from "./removal-confirmation.ts";
import { subtitleAccepted } from "#domain/subtitle-quality.ts";
import { currentSubtitlePolicies, policyStatus } from "./subtitle-policy.ts";
import { OwnerHealthSchema } from "#shared/notification-authority.ts";

export class PrismaMediaApplication
  extends PrismaMediaCommands
  implements MediaApplication
{
  constructor(
    private readonly db: Database,
    settings: MediaCommandSettings,
  ) {
    super(db, settings);
  }

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
    const item = await this.db.mediaItem.findUnique({
      where: { id: mediaId },
      include: {
        children: {
          orderBy: [{ seasonNumber: "asc" }, { episodeNumber: "asc" }],
          take: 1000,
        },
        intent: true,
        requests: {
          where: { active: true },
          select: {
            id: true,
            userId: true,
            subtitleLanguages: true,
            version: true,
            user: { select: { displayName: true } },
          },
        },
        holds: { select: { id: true, userId: true, until: true, isPin: true } },
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
          where: actor.role === "owner" ? {} : { userId: actor.id },
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
      throw new MediaError("media_not_found", "Media item does not exist", 404);
    const events = await this.db.applicationEvent.findMany({
      where: {
        mediaId,
        ...(actor.role === "owner"
          ? {}
          : { OR: [{ actorId: actor.id }, { actorId: null }] }),
      },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: { id: true, kind: true, createdAt: true },
    });
    const runtime = await this.db.mediaRuntimeState.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const policies = await currentSubtitlePolicies(this.db, [mediaId]);
    return MediaDetailSchema.parse({
      ...item,
      subtitlePolicies: policies,
      assets: item.assets.map((coverage) => ({
        ...coverage,
        asset: {
          ...coverage.asset,
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
      ...(actor.role === "owner"
        ? { removalConfirmation: await removalConfirmation(this.db, mediaId) }
        : {}),
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

  async releases(_actor: MediaActor, mediaId: string) {
    return ReleaseListSchema.parse(
      await this.db.releaseCandidate.findMany({
        where: { mediaIds: { has: mediaId } },
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
