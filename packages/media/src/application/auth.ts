import type {
  PlexServerAccess,
  PlexPermissionSnapshot,
} from "./plex-access.ts";

export type MediaActor = {
  id: string;
  plexAccountId: string;
  displayName: string;
  role: "owner" | "member";
  restricted: boolean;
  version: number;
};

export type PlexIdentity = {
  accountId: string;
  displayName: string;
  token: string;
};

export type PlexAuthentication = {
  createPin: () => Promise<{
    id: number;
    code: string;
    expiresAt: Date;
    authorizationUrl: string;
    deviceState: string;
  }>;
  resolvePin: (
    id: number,
    code: string,
    deviceState: string,
  ) => Promise<PlexIdentity | null>;
  resolveServerToken: (token: string) => Promise<string | null>;
  resolveServerAccess: (token: string) => Promise<PlexServerAccess | null>;
  refresh: (deviceState: string) => Promise<string>;
};

export type AuthStore = {
  saveLogin: (login: {
    id: string;
    pinId: number;
    pinCode: string;
    browserHash: string;
    expiresAt: Date;
    encryptedDevice: string;
  }) => Promise<void>;
  getLogin: (id: string) => Promise<{
    id: string;
    pinId: number;
    pinCode: string;
    browserHash: string;
    expiresAt: Date;
    encryptedDevice: string;
  } | null>;
  /** Consumes the PIN, upserts account and credential, and inserts session atomically. */
  completeLogin: (input: {
    loginId: string;
    now: Date;
    accountId: string;
    displayName: string;
    ownerAccountId: string;
    encryptedCredential: string;
    access: PlexPermissionSnapshot;
    sessionId: string;
    csrfHash: string;
    expiresAt: Date;
  }) => Promise<MediaActor>;
  getSession: (
    id: string,
    now: Date,
  ) => Promise<{
    actor: MediaActor;
    csrfHash: string;
    encryptedCredential: string;
  } | null>;
  updateCredential: (
    userId: string,
    ciphertext: string,
    expectedCiphertext: string,
  ) => Promise<boolean>;
  revokeSession: (id: string) => Promise<void>;
  updateAccess: (
    userId: string,
    access: PlexPermissionSnapshot,
  ) => Promise<MediaActor>;
};

export type MediaAuthOptions = {
  ownerAccountId: string;
  sessionLifetimeMs: number;
  clock?: () => Date;
};
