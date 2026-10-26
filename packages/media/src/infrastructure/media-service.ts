import type { MediaActor } from "#application/auth.ts";
import { requireOwner } from "#application/errors.ts";
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
} from "#shared/api.ts";
import { ReleaseListSchema } from "#shared/api.ts";
import {
  captureVisibilityPlexAccess,
  type VisibilityPlexAccess,
  type VisibilitySections,
} from "./visibility/access.ts";
import { readMediaDetail } from "./visibility/media-detail.ts";
import { effectiveRequestWhere } from "./request-claims.ts";
import { OwnerHealthSchema } from "#shared/notification-authority.ts";
import { readDefaultCommandContext } from "./editions/command-context.ts";
import { repeatableRead } from "./locks.ts";
import {
  readMovieEditionContext,
  readMovieEditionRequests,
} from "./movie-editions/view.ts";

export class PrismaMediaApplication
  extends PrismaMediaCommands
  implements MediaApplication
{
  constructor(
    private readonly db: Database,
    settings: MediaCommandSettings & {
      visibilitySections?: VisibilitySections;
      plexAccess?: VisibilityPlexAccess;
    },
  ) {
    super(db, {
      ...settings,
      sections: settings.visibilitySections ?? settings.sections,
      movieSectionId:
        settings.movieSectionId ??
        settings.visibilitySections?.movie ??
        settings.sections?.movie,
    });
    this.visibilitySections = settings.visibilitySections;
    this.visibilityPlexAccess = settings.plexAccess;
  }
  private readonly visibilitySections: VisibilitySections | undefined;
  private readonly visibilityPlexAccess: VisibilityPlexAccess | undefined;

  async getMovieEditionContext(
    actor: MediaActor,
    mediaId: string,
    subjectUserId: string,
  ) {
    const access = await this.configuredMovieChoiceAccess();
    return repeatableRead(this.db, (tx) =>
      readMovieEditionContext(tx, actor, {
        mediaId,
        subjectUserId,
        access,
      }),
    );
  }

  async listMovieEditionRequests(
    actor: MediaActor,
    input: { subjectUserId: string; cursor: string | null },
  ) {
    const access = await this.configuredMovieChoiceAccess();
    return repeatableRead(this.db, (tx) =>
      readMovieEditionRequests(tx, actor, {
        ...input,
        access,
      }),
    );
  }

  getDefaultCommandContext(actor: MediaActor, mediaId: string) {
    return repeatableRead(this.db, (tx) =>
      readDefaultCommandContext(tx, actor, mediaId, {
        serverMachineId: this.settings.serverMachineId,
        sections: this.visibilitySections,
      }),
    );
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
    const selected = await this.db.mediaItem.findUnique({
      where: { id: mediaId },
      select: { kind: true },
    });
    const plexAccess =
      selected === null
        ? null
        : await captureVisibilityPlexAccess(
            {
              serverMachineId: this.settings.serverMachineId,
              movieSectionId: this.settings.movieSectionId,
              sections: this.visibilitySections ?? this.settings.sections,
              plexAccess: this.visibilityPlexAccess,
            },
            selected.kind,
          );
    const movieChoiceAccess =
      this.settings.movieAccess === undefined || selected?.kind !== "movie"
        ? undefined
        : await this.configuredMovieChoiceAccess();
    return readMediaDetail(this.db, {
      actor,
      mediaId,
      expectedKind: selected?.kind,
      plexAccess,
      movieChoiceAccess,
      sections: this.visibilitySections,
      serverMachineId: this.settings.serverMachineId,
      movieSectionId: this.settings.movieSectionId,
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
          edition: "default",
          state: { in: ["warning_pending", "grace_period", "quarantined"] },
          ...(actor.role === "owner"
            ? {}
            : {
                media: {
                  requests: {
                    some: { userId: actor.id, ...effectiveRequestWhere },
                  },
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
    const movieChoiceAccess = await this.movieChoiceAccessForMedia(mediaId);
    return this.db.$transaction(
      async (tx) => {
        await lockCanonicalMedia(tx, input.mediaIds);
        await lockExistingDefaultTargets(tx, input.mediaIds);
        await lockEffectiveRequests(tx, input.mediaIds);
        await commandAutomationEpoch(tx);
        return buildIdentityPreview(tx, actor, {
          ...input,
          mediaId,
          releaseId,
          ...this.settings,
          movieChoiceAccess,
        });
      },
      { isolationLevel: "Serializable" },
    );
  }

  async releases(actor: MediaActor, mediaId: string) {
    await this.db.$transaction(async (tx) => {
      await lockCanonicalMedia(tx, [mediaId]);
      await lockExistingDefaultTargets(tx, [mediaId]);
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
import {
  lockCanonicalMedia,
  lockExistingDefaultTargets,
} from "./editions/locks.ts";
import { lockEffectiveRequests } from "./request-claims.ts";
import { commandAutomationEpoch } from "./handoff/authority.ts";
import { authorizeRenewal } from "./action-guards.ts";
