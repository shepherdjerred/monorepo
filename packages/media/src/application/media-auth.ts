import { MediaError } from "./errors.ts";
import {
  matchesHash,
  randomToken,
  tokenHash,
  type CredentialCipher,
} from "./security.ts";
import {
  permissionSnapshot,
  refreshPlexAccountAccess,
} from "./plex-account-access.ts";
import type {
  AuthStore,
  PlexAuthentication,
  MediaAuthOptions,
} from "./auth.ts";

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
    const actor = await refreshPlexAccountAccess(session, {
      store: this.store,
      plex: this.plex,
      cipher: this.cipher,
      assertActive: () => {
        // HTTP authentication retains its session checks; it has no Activity deadline.
      },
    });
    if (actor === null) {
      await this.store.revokeSession(tokenHash(token));
      throw new MediaError(
        "server_access_revoked",
        "Access to the permitted Plex libraries was revoked",
        403,
      );
    }
    return { actor, csrfHash: session.csrfHash };
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
