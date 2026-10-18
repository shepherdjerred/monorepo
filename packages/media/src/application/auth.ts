import { MediaError } from "./errors.ts";
import {
  matchesHash,
  randomToken,
  tokenHash,
  type CredentialCipher,
} from "./security.ts";
import { z } from "zod";
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
  ) => Promise<void>;
};

export type MediaAuthOptions = {
  ownerAccountId: string;
  sessionLifetimeMs: number;
  clock?: () => Date;
};

export class MediaAuth {
  private readonly now: () => Date;
  constructor(
    private readonly store: AuthStore,
    private readonly plex: PlexAuthentication,
    private readonly cipher: CredentialCipher,
    private readonly options: MediaAuthOptions,
  ) {
    this.now = options.clock ?? (() => new Date());
  }

  async start() {
    const pin = await this.plex.createPin();
    const browserToken = randomToken();
    const id = crypto.randomUUID();
    await this.store.saveLogin({
      id,
      pinId: pin.id,
      pinCode: pin.code,
      browserHash: tokenHash(browserToken),
      expiresAt: pin.expiresAt,
      encryptedDevice: this.cipher.encrypt(pin.deviceState, `login:${id}`),
    });
    return {
      id,
      authorizationUrl: pin.authorizationUrl,
      expiresAt: pin.expiresAt.toISOString(),
      browserToken,
    };
  }

  async poll(id: string, browserToken: string) {
    const now = this.now();
    const login = await this.store.getLogin(id);
    if (
      !login ||
      login.expiresAt <= now ||
      !matchesHash(browserToken, login.browserHash)
    ) {
      throw new MediaError(
        "login_expired",
        "Login expired or belongs to another browser",
        401,
      );
    }
    const deviceState = this.cipher.decrypt(
      login.encryptedDevice,
      `login:${id}`,
    );
    const identity = await this.plex.resolvePin(
      login.pinId,
      login.pinCode,
      deviceState,
    );
    if (!identity) return null;
    const access = await this.plex.resolveServerAccess(identity.token);
    if (access?.accountId !== identity.accountId) {
      throw new MediaError(
        "server_access_required",
        "This Plex account does not have access to a permitted library on the configured server",
        403,
      );
    }
    const sessionToken = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(now.getTime() + this.options.sessionLifetimeMs);
    const actor = await this.store.completeLogin({
      loginId: id,
      now,
      accountId: identity.accountId,
      displayName: identity.displayName,
      ownerAccountId: this.options.ownerAccountId,
      access: permissionSnapshot(access),
      encryptedCredential: this.cipher.encrypt(
        JSON.stringify({
          token: identity.token,
          serverToken: access.serverToken,
          deviceState,
        }),
        `plex:${identity.accountId}`,
      ),
      sessionId: tokenHash(sessionToken),
      csrfHash: tokenHash(csrfToken),
      expiresAt,
    });
    return { actor, sessionToken, csrfToken, expiresAt };
  }

  async authenticate(token: string | undefined) {
    if (token === undefined || token.length === 0)
      throw new MediaError("unauthenticated", "Sign in with Plex", 401);
    const session = await this.store.getSession(tokenHash(token), this.now());
    if (!session)
      throw new MediaError(
        "session_expired",
        "Session expired; sign in again",
        401,
      );
    const credential = z
      .object({
        token: z.string(),
        serverToken: z.string(),
        deviceState: z.string(),
      })
      .parse(
        JSON.parse(
          this.cipher.decrypt(
            session.encryptedCredential,
            `plex:${session.actor.plexAccountId}`,
          ),
        ),
      );
    let access: PlexServerAccess | null;
    let refreshed = false;
    try {
      access = await this.plex.resolveServerAccess(credential.token);
    } catch (error) {
      if (!(error instanceof MediaError) || error.code !== "plex_token_expired")
        throw error;
      credential.token = await this.plex.refresh(credential.deviceState);
      refreshed = true;
      access = await this.plex.resolveServerAccess(credential.token);
    }
    if (access?.accountId !== session.actor.plexAccountId) {
      await this.store.revokeSession(tokenHash(token));
      throw new MediaError(
        "server_access_revoked",
        "Access to the permitted Plex libraries was revoked",
        403,
      );
    }
    await this.store.updateAccess(session.actor.id, permissionSnapshot(access));
    if (refreshed || credential.serverToken !== access.serverToken) {
      credential.serverToken = access.serverToken;
      await this.store.updateCredential(
        session.actor.id,
        this.cipher.encrypt(
          JSON.stringify(credential),
          `plex:${session.actor.plexAccountId}`,
        ),
        session.encryptedCredential,
      );
    }
    return { actor: session.actor, csrfHash: session.csrfHash };
  }

  verifyCsrf(token: string | undefined, expectedHash: string): void {
    if (
      token === undefined ||
      token.length === 0 ||
      !matchesHash(token, expectedHash)
    )
      throw new MediaError(
        "csrf_required",
        "A valid CSRF token is required",
        403,
      );
  }

  async logout(token: string): Promise<void> {
    await this.store.revokeSession(tokenHash(token));
  }
}

function permissionSnapshot(access: PlexServerAccess): PlexPermissionSnapshot {
  const { serverToken: _token, ...snapshot } = access;
  return snapshot;
}
