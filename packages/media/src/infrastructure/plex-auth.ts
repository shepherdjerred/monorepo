import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { z } from "zod";
import type { PlexAuthentication } from "#application/auth.ts";
import { MediaError } from "#application/errors.ts";
import type { PlexServerAccess } from "#application/plex-access.ts";
import { PlexClient } from "#integrations/plex.ts";

const DeviceSchema = z.object({
  clientId: z.string(),
  keyId: z.string(),
  privateKey: z.string(),
});
const PinSchema = z.object({
  id: z.number().int(),
  code: z.string(),
  expiresAt: z.coerce.date(),
});
const ResultSchema = z.object({ authToken: z.string().nullable() });
const IdentitySchema = z.object({ id: z.number().int(), username: z.string() });
const ResourceSchema = z.array(
  z.object({
    clientIdentifier: z.string(),
    provides: z.string(),
    accessToken: z.string().nullable(),
  }),
);

export type PlexAuthSettings = {
  serverMachineId: string;
  serverUrl: string;
  permittedMovieSectionId: string;
  permittedTvSectionId: string;
  applicationName: string;
  returnUrl: string;
};

/** Dedicated device keys are registered for each login; existing apps are untouched. */
export class PlexPinAuthentication implements PlexAuthentication {
  constructor(
    private readonly settings: PlexAuthSettings,
    private readonly request: (
      input: URL | string,
      init?: RequestInit,
    ) => Promise<Response> = fetch,
  ) {}

  private async json(
    url: URL | string,
    clientId: string,
    init: RequestInit = {},
  ) {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    headers.set("X-Plex-Product", this.settings.applicationName);
    headers.set("X-Plex-Client-Identifier", clientId);
    const response = await this.request(url, {
      ...init,
      headers,
      signal: AbortSignal.timeout(15_000),
      redirect: "error",
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 498)
        throw new MediaError(
          "plex_token_expired",
          "Plex credentials require refresh",
          401,
        );
      throw new MediaError(
        "plex_unavailable",
        "Plex authentication is temporarily unavailable",
        response.status === 429 ? 429 : 502,
      );
    }
    const value: unknown = await response.json();
    return value;
  }

  private jwt(deviceState: string, nonce?: string) {
    const device = DeviceSchema.parse(JSON.parse(deviceState));
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ kid: device.keyId, alg: "EdDSA", typ: "JWT" }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        aud: "plex.tv",
        iss: device.clientId,
        iat: now,
        exp: now + 300,
        scope: "username,friendly_name,restricted",
        ...(nonce === undefined ? {} : { nonce }),
      }),
    ).toString("base64url");
    const unsigned = `${header}.${payload}`;
    return {
      clientId: device.clientId,
      signed: `${unsigned}.${sign(null, Buffer.from(unsigned), createPrivateKey(device.privateKey)).toString("base64url")}`,
    };
  }

  async createPin() {
    const keys = generateKeyPairSync("ed25519");
    const clientId = crypto.randomUUID();
    const keyId = crypto.randomUUID();
    const deviceState = JSON.stringify({
      clientId,
      keyId,
      privateKey: keys.privateKey.export({ format: "pem", type: "pkcs8" }),
    });
    const jwk = keys.publicKey.export({ format: "jwk" });
    const pin = PinSchema.parse(
      await this.json("https://clients.plex.tv/api/v2/pins", clientId, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          strong: true,
          jwk: { ...jwk, kid: keyId, alg: "EdDSA", use: "sig" },
        }),
      }),
    );
    const parameters = new URLSearchParams({
      clientID: clientId,
      code: pin.code,
      "context[device][product]": this.settings.applicationName,
      forwardUrl: this.settings.returnUrl,
    });
    return {
      ...pin,
      deviceState,
      authorizationUrl: `https://app.plex.tv/auth#?${parameters.toString()}`,
    };
  }

  async resolvePin(id: number, code: string, deviceState: string) {
    const jwt = this.jwt(deviceState);
    const url = new URL(`https://clients.plex.tv/api/v2/pins/${String(id)}`);
    url.searchParams.set("deviceJWT", jwt.signed);
    url.searchParams.set("code", code);
    const pin = ResultSchema.parse(await this.json(url, jwt.clientId));
    if (pin.authToken === null) return null;
    const identity = IdentitySchema.parse(
      await this.json("https://plex.tv/api/v2/user", jwt.clientId, {
        headers: { "X-Plex-Token": pin.authToken },
      }),
    );
    return {
      accountId: String(identity.id),
      displayName: identity.username,
      token: pin.authToken,
    };
  }

  async resolveServerToken(token: string) {
    const resources = ResourceSchema.parse(
      await this.json(
        "https://plex.tv/api/v2/resources",
        "media-access-check",
        { headers: { "X-Plex-Token": token } },
      ),
    );
    const server = resources.find(
      (resource) =>
        resource.clientIdentifier === this.settings.serverMachineId &&
        resource.provides.split(",").includes("server"),
    );
    return server?.accessToken ?? null;
  }

  async resolveServerAccess(token: string): Promise<PlexServerAccess | null> {
    const serverToken = await this.resolveServerToken(token);
    if (serverToken === null) return null;
    const identity = z
      .object({ id: z.number().int().positive(), restricted: z.boolean() })
      .parse(
        await this.json("https://plex.tv/api/v2/user", "media-access-check", {
          headers: { "X-Plex-Token": token },
        }),
      );
    const client = new PlexClient(
      {
        baseUrl: this.settings.serverUrl,
        token: serverToken,
        clientIdentifier: "media-access-check",
      },
      this.request,
    );
    if ((await client.machineIdentifier()) !== this.settings.serverMachineId)
      throw new MediaError(
        "plex_server_mismatch",
        "The configured Plex endpoint belongs to another server",
        503,
      );
    const sections = await client.sections();
    const permitted = sections.filter(
      (section) =>
        (section.key === this.settings.permittedMovieSectionId &&
          section.type === "movie") ||
        (section.key === this.settings.permittedTvSectionId &&
          section.type === "show"),
    );
    if (permitted.length === 0) return null;
    return {
      accountId: String(identity.id),
      serverMachineId: this.settings.serverMachineId,
      serverToken,
      permittedSectionIds: permitted.map((section) => section.key),
      permittedMediaKinds: permitted.map((section) =>
        section.type === "movie" ? "movie" : "series",
      ),
      plexRestricted: identity.restricted,
    };
  }

  async refresh(deviceState: string): Promise<string> {
    const device = DeviceSchema.parse(JSON.parse(deviceState));
    const { nonce } = z
      .object({ nonce: z.string() })
      .parse(
        await this.json(
          "https://clients.plex.tv/api/v2/auth/nonce",
          device.clientId,
        ),
      );
    const jwt = this.jwt(deviceState, nonce);
    const response = await this.json(
      "https://clients.plex.tv/api/v2/auth/token",
      device.clientId,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jwt: jwt.signed }),
      },
    );
    return z.object({ auth_token: z.string().min(1) }).parse(response)
      .auth_token;
  }
}
