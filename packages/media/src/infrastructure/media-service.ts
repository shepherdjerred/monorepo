import type { MediaActor } from "#application/auth.ts";
import type { Prisma } from "#generated/prisma/client.ts";
import { requireOwner } from "#application/errors.ts";
import type { MediaApplication } from "#application/ports.ts";
import type { MovieLifecycleApplicationV4 } from "#application/movie-lifecycle-ports-v4.ts";
import type { MovieEditionScope } from "#shared/movie-editions/registry.ts";
import { PublicationAuthorityReadBudget } from "#infrastructure/publication-proof/read-budget.ts";
import {
  readMovieEditionContextV4,
  readMovieEditionRequestsV4,
} from "./movie-editions/lifecycle/public/public-view.ts";
import { readMovieTargetContextV4 } from "./movie-editions/lifecycle/target-view.ts";
import { PrismaMediaCommands } from "./commands.ts";
import type { MediaCommandSettings } from "./command-base.ts";
import type { Database } from "./database.ts";
import {
  RequestListSchema,
  OperationListSchema,
  UserListSchema,
} from "#shared/api.ts";
import { ReleaseListSchema } from "#shared/api.ts";
import {
  captureVisibilityPlexAccess,
  visibilityAncestry,
  type VisibilityPlexAccess,
  type VisibilitySections,
} from "./visibility/access.ts";
import { readMediaDetail } from "./visibility/media-detail.ts";
import { rootReference } from "./library/views/artwork.ts";
import { readRemovalList } from "./library/views/removal-list.ts";
import { projectExternalRequests } from "./external-library/availability.ts";
import { readNotificationList } from "./notifications/list.ts";
import {
  readDefaultCommandContext,
  readDefaultCommandContexts,
} from "./editions/command-context.ts";
import { repeatableRead } from "./locks.ts";
import {
  readMovieEditionContext,
  readMovieEditionRequests,
} from "./movie-editions/view.ts";
import { captureMovieActionAccessV4 } from "./movie-editions/lifecycle/public/public-access.ts";

/**
 * A series request fans out into one claim per episode, and the list holds 200
 * rows. What a person asked for comes first, so a long series' episode claims
 * can never push a direct request off the list; each group is newest first.
 */
const requestListOrder = [
  { direct: "desc" },
  { updatedAt: "desc" },
  { id: "desc" },
] satisfies Prisma.MediaRequestOrderByWithRelationInput[];

export class PrismaMediaApplication
  extends PrismaMediaCommands
  implements MediaApplication, MovieLifecycleApplicationV4
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

  async getMovieEditionContextV4(
    actor: MediaActor,
    mediaId: string,
    subjectUserId: string,
  ) {
    const budget = new PublicationAuthorityReadBudget();
    const access = await this.configuredMovieChoiceAccess();
    return repeatableRead(this.db, (tx) =>
      readMovieEditionContextV4(
        tx,
        actor,
        { mediaId, subjectUserId, access },
        budget,
      ),
    );
  }

  async listMovieEditionRequestsV4(
    actor: MediaActor,
    input: { subjectUserId: string; cursor: string | null },
  ) {
    const budget = new PublicationAuthorityReadBudget();
    const access = await captureMovieActionAccessV4(
      this.settings,
      () => this.configuredMovieChoiceAccess(),
      "keep",
    );
    return repeatableRead(this.db, (tx) =>
      readMovieEditionRequestsV4(
        tx,
        actor,
        { ...input, access: access.choice, protection: access.protection },
        budget,
      ),
    );
  }

  async getMovieTargetContextV4(
    actor: MediaActor,
    scope: MovieEditionScope,
    includeDiscovery = false,
  ) {
    const budget = new PublicationAuthorityReadBudget();
    const access = await captureMovieActionAccessV4(
      this.settings,
      () => this.configuredMovieChoiceAccess(),
      "keep",
    );
    return repeatableRead(this.db, (tx) =>
      readMovieTargetContextV4(
        tx,
        actor,
        {
          scope,
          access: access.choice,
          protection: access.protection,
          includeDiscovery,
        },
        budget,
      ),
    );
  }

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

  getDefaultCommandContexts(actor: MediaActor, mediaIds: readonly string[]) {
    return repeatableRead(this.db, (tx) =>
      readDefaultCommandContexts(tx, actor, mediaIds, {
        serverMachineId: this.settings.serverMachineId,
        sections: this.visibilitySections,
      }),
    );
  }

  async listRequests(actor: MediaActor) {
    const selected = await this.db.mediaRequest.findMany({
      where: actor.role === "owner" ? {} : { userId: actor.id },
      select: { mediaId: true },
      orderBy: requestListOrder,
      take: 200,
    });
    const candidates = await this.db.assetCoverage.findMany({
      where: {
        current: true,
        edition: "default",
        mediaId: { in: selected.map((request) => request.mediaId) },
        asset: {
          owned: false,
          properties: { path: ["externalLibrary", "schemaVersion"], equals: 1 },
        },
      },
      select: { mediaId: true, media: { select: { kind: true } } },
    });
    const kinds = [
      ...new Set(
        candidates.map((row) =>
          row.media.kind === "movie" ? "movie" : "episode",
        ),
      ),
    ];
    const access = await Promise.all(
      kinds.map((kind) =>
        captureVisibilityPlexAccess(
          {
            serverMachineId: this.settings.serverMachineId,
            movieSectionId: this.settings.movieSectionId,
            sections: this.visibilitySections ?? this.settings.sections,
            plexAccess: this.visibilityPlexAccess,
          },
          kind,
        ),
      ),
    );
    return repeatableRead(this.db, async (tx) => {
      const requests = await tx.mediaRequest.findMany({
        where: actor.role === "owner" ? {} : { userId: actor.id },
        include: { media: { include: visibilityAncestry } },
        orderBy: requestListOrder,
        take: 200,
      });
      const projected = await projectExternalRequests(tx, actor, requests, {
        access,
        serverMachineId: this.settings.serverMachineId,
      });
      return RequestListSchema.parse(
        projected.map((request) => ({
          ...request,
          ...rootReference(request.media),
        })),
      );
    });
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

  removals(actor: MediaActor) {
    return readRemovalList(this.db, actor, {
      serverMachineId: this.settings.serverMachineId,
      sections: this.visibilitySections ?? this.settings.sections,
    });
  }

  notifications(actor: MediaActor) {
    return readNotificationList(this.db, actor);
  }

  profiles(actor: MediaActor) {
    return readQualityProfiles(this.db, actor);
  }
  profileDefaults(actor: MediaActor) {
    return readProfileDefaults(this.db, actor);
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
    const current = await this.db.$transaction(async (tx) => {
      await lockCanonicalMedia(tx, [mediaId]);
      await lockExistingDefaultTargets(tx, [mediaId]);
      await lockEffectiveRequests(tx, [mediaId]);
      await tx.$queryRaw`SELECT id FROM "MediaRuntimeState" WHERE id = 'singleton' FOR SHARE`;
      return authorizeRenewal(tx, actor, {
        mediaId,
        action: "retry",
        ...this.settings,
      });
    });
    // Release titles, provider ids, evaluations and resolved evidence are
    // operator data. A requester keeps a successful, empty read rather than a
    // refusal, which an open member page would render as an error.
    if (current.role !== "owner") return [];
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
import {
  readProfileDefaults,
  readQualityProfiles,
} from "./quality-profiles/read.ts";
import type { IdentityPreviewInput } from "#shared/acquisition/preview.ts";
import { buildIdentityPreview } from "./acquisition-identity/preview.ts";
import {
  lockCanonicalMedia,
  lockExistingDefaultTargets,
} from "./editions/locks.ts";
import { lockEffectiveRequests } from "./request-claims.ts";
import { commandAutomationEpoch } from "./handoff/authority.ts";
import { authorizeRenewal } from "./action-guards.ts";
