import type { CreateRequest, MediaAction } from "#shared/contract.ts";
import type { MediaActor } from "./auth.ts";
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

export type MediaApplication = {
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
