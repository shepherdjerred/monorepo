import type { CreateRequest, MediaAction } from "#shared/contract.ts";
import type { MediaActor } from "./auth.ts";
import type {
  DefaultCommandV2,
  DefaultCommandResultV2,
} from "#shared/editions/commands.ts";
import type { DefaultTargetView } from "#shared/editions/target-view.ts";
import type {
  CommandResult,
  RequestList,
  MediaDetail,
  OperationList,
  RemovalList,
  NotificationList,
  ProfileList,
  UserList,
  CatalogSearch,
  CatalogDetail,
} from "#shared/api.ts";
import type { ReleaseList, SaveQualityProfile } from "#shared/api.ts";
import type { ProfileDefaults } from "#shared/api.ts";
import type {
  MovieEditionContextV3,
  MovieEditionRequestListV3,
} from "#shared/movie-editions/view.ts";
import type {
  MovieRequestV3,
  MovieRequestResultV3,
  CancelMovieRequestV3,
  CancelMovieRequestResultV3,
  RevokeMovieEditionChoiceV3,
  RevokeMovieEditionChoiceResultV3,
} from "#shared/movie-editions/commands.ts";

export type MediaApplication = {
  getMovieEditionContext: (
    actor: MediaActor,
    mediaId: string,
    subjectUserId: string,
  ) => Promise<MovieEditionContextV3>;
  listMovieEditionRequests: (
    actor: MediaActor,
    input: { subjectUserId: string; cursor: string | null },
  ) => Promise<MovieEditionRequestListV3>;
  requestMovieEdition: (
    actor: MediaActor,
    key: string,
    input: MovieRequestV3,
    beforeNewCommand?: () => Promise<void>,
  ) => Promise<MovieRequestResultV3>;
  cancelMovieEditionRequest: (
    actor: MediaActor,
    key: string,
    input: CancelMovieRequestV3,
    beforeNewCommand?: () => Promise<void>,
  ) => Promise<CancelMovieRequestResultV3>;
  revokeMovieEditionChoice: (
    actor: MediaActor,
    key: string,
    input: RevokeMovieEditionChoiceV3,
    beforeNewCommand?: () => Promise<void>,
  ) => Promise<RevokeMovieEditionChoiceResultV3>;
  getDefaultCommandContext: (
    actor: MediaActor,
    mediaId: string,
  ) => Promise<DefaultTargetView>;
  executeDefaultCommand: (
    actor: MediaActor,
    key: string,
    input: DefaultCommandV2,
    beforeNewCommand?: () => Promise<void>,
  ) => Promise<DefaultCommandResultV2>;
  identityPreview: (
    actor: MediaActor,
    mediaId: string,
    releaseId: string,
    input: IdentityPreviewInput,
  ) => Promise<IdentityPreview>;
  createRequest: (
    actor: MediaActor,
    key: string,
    input: CreateRequest,
  ) => Promise<CommandResult>;
  cancelRequest: (
    actor: MediaActor,
    key: string,
    id: string,
    expectedVersion: number,
  ) => Promise<CommandResult>;
  act: (
    actor: MediaActor,
    key: string,
    mediaId: string,
    input: MediaAction,
  ) => Promise<CommandResult>;
  listRequests: (actor: MediaActor) => Promise<RequestList>;
  getMedia: (actor: MediaActor, mediaId: string) => Promise<MediaDetail>;
  activity: (actor: MediaActor) => Promise<OperationList>;
  removals: (actor: MediaActor) => Promise<RemovalList>;
  notifications: (actor: MediaActor) => Promise<NotificationList>;
  profiles: (actor: MediaActor) => Promise<ProfileList>;
  profileDefaults: (actor: MediaActor) => Promise<ProfileDefaults>;
  setProfileDefault: (
    actor: MediaActor,
    key: string,
    kind: "movie" | "series",
    input: { expectedVersion: number; profileId: string },
  ) => Promise<CommandResult>;
  listUsers: (actor: MediaActor) => Promise<UserList>;
  restrictUser: (
    actor: MediaActor,
    key: string,
    userId: string,
    input: { expectedVersion: number; restricted: boolean },
  ) => Promise<CommandResult>;
  releases: (actor: MediaActor, mediaId: string) => Promise<ReleaseList>;
  saveProfile: (
    actor: MediaActor,
    key: string,
    input: SaveQualityProfile,
  ) => Promise<CommandResult>;
  assignProfile: (
    actor: MediaActor,
    key: string,
    mediaId: string,
    input: { expectedVersion: number; profileId: string },
  ) => Promise<CommandResult>;
};
import type {
  IdentityPreview,
  IdentityPreviewInput,
} from "#shared/acquisition/preview.ts";

export type CatalogApplication = {
  search: (query: string) => Promise<CatalogSearch>;
  details: (
    kind: "movie" | "series",
    externalId: number,
  ) => Promise<CatalogDetail>;
  adopt: (
    kind: "movie" | "series",
    externalId: number,
  ) => Promise<{ mediaId: string }>;
};
