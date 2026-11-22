import { z } from "zod";
import {
  bearer,
  fetchJson,
  type Fetch,
} from "@shepherdjerred/ops-clients/http.ts";

const TAILSCALE_API = "https://api.tailscale.com/api/v2";
const DAY_MS = 86_400_000;
const OAUTH_REFRESH_SKEW_MS = 60_000;

const OAuthTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

const RawDeviceSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  hostname: z.string(),
  os: z.string().default("unknown"),
  clientVersion: z.string().default(""),
  updateAvailable: z.boolean().default(false),
  connectedToControl: z.boolean().optional(),
  online: z.boolean().optional(),
  keyExpiryDisabled: z.boolean().default(false),
  lastSeen: z.string().nullable().optional(),
  expires: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  addresses: z.array(z.string()).default([]),
});

const DevicesEnvelopeSchema = z.object({
  devices: z.array(RawDeviceSchema),
});

export type TailscaleOAuthCredentials = {
  clientId: string;
  clientSecret: string;
};

export type TailscaleClientOptions = {
  apiKey?: string;
  oauth?: TailscaleOAuthCredentials;
  clientId?: string;
  clientSecret?: string;
  tailnet?: string;
  fetch?: Fetch;
};

export type TailscaleDevice = {
  id: string;
  name: string;
  hostname: string;
  os: string;
  clientVersion: string;
  updateAvailable: boolean;
  online: boolean;
  connectedToControl: boolean;
  lastSeen: string | null;
  expires: string | null;
  daysToExpiry: number | null;
  tags: string[];
  addresses: string[];
};

function normalizeExpiry(
  rawExpires: string | null | undefined,
  keyExpiryDisabled: boolean,
  nowMs: number,
): { expires: string | null; daysToExpiry: number | null } {
  if (
    keyExpiryDisabled ||
    rawExpires === null ||
    rawExpires === undefined ||
    rawExpires === "" ||
    rawExpires.startsWith("0001-")
  ) {
    return { expires: null, daysToExpiry: null };
  }
  const expiresMs = Date.parse(rawExpires);
  if (!Number.isFinite(expiresMs)) {
    return { expires: null, daysToExpiry: null };
  }
  return {
    expires: rawExpires,
    daysToExpiry: Math.floor((expiresMs - nowMs) / DAY_MS),
  };
}

/** Read-only Tailscale v2 API client supporting API key or OAuth client credentials. */
export class TailscaleClient {
  readonly #apiKey: string | undefined;
  readonly #oauth: TailscaleOAuthCredentials | undefined;
  readonly #tailnet: string;
  readonly #fetch: Fetch;
  #cachedToken: { token: string; refreshAfterMs: number } | undefined;

  constructor(options: TailscaleClientOptions) {
    const oauth =
      options.oauth ??
      (options.clientId !== undefined && options.clientSecret !== undefined
        ? { clientId: options.clientId, clientSecret: options.clientSecret }
        : undefined);
    if (
      oauth === undefined &&
      (options.apiKey === undefined || options.apiKey === "")
    ) {
      throw new Error(
        "TailscaleClient requires either apiKey or OAuth { clientId, clientSecret }",
      );
    }
    this.#apiKey = options.apiKey;
    this.#oauth = oauth;
    this.#tailnet = options.tailnet ?? "-";
    this.#fetch = options.fetch ?? fetch;
  }

  async #accessToken(): Promise<string> {
    if (this.#apiKey !== undefined && this.#apiKey !== "") {
      return this.#apiKey;
    }
    if (this.#oauth === undefined) {
      throw new Error("TailscaleClient has no configured credentials");
    }
    const nowMs = Date.now();
    if (
      this.#cachedToken !== undefined &&
      nowMs < this.#cachedToken.refreshAfterMs
    ) {
      return this.#cachedToken.token;
    }
    const body = new URLSearchParams({
      client_id: this.#oauth.clientId,
      client_secret: this.#oauth.clientSecret,
      grant_type: "client_credentials",
    });
    const tokenResp = await fetchJson(
      this.#fetch,
      {
        upstream: "tailscale",
        url: `${TAILSCALE_API}/oauth/token`,
        init: {
          method: "POST",
          body,
        },
      },
      OAuthTokenSchema,
    );
    this.#cachedToken = {
      token: tokenResp.access_token,
      refreshAfterMs:
        nowMs + tokenResp.expires_in * 1000 - OAUTH_REFRESH_SKEW_MS,
    };
    return tokenResp.access_token;
  }

  /** List tailnet devices (`?fields=all`) with normalized status and key expiry. */
  async listDevices(now = new Date()): Promise<TailscaleDevice[]> {
    const token = await this.#accessToken();
    const url = `${TAILSCALE_API}/tailnet/${encodeURIComponent(this.#tailnet)}/devices?fields=all`;
    const response = await fetchJson(
      this.#fetch,
      {
        upstream: "tailscale",
        url,
        init: {
          headers: {
            accept: "application/json",
            ...bearer(token),
          },
        },
      },
      DevicesEnvelopeSchema,
    );
    const nowMs = now.getTime();
    return response.devices.map((device) => {
      const connected = device.connectedToControl ?? device.online ?? false;
      const { expires, daysToExpiry } = normalizeExpiry(
        device.expires,
        device.keyExpiryDisabled,
        nowMs,
      );
      return {
        id: device.id,
        name: device.name,
        hostname: device.hostname,
        os: device.os,
        clientVersion: device.clientVersion,
        updateAvailable: device.updateAvailable,
        online: connected,
        connectedToControl: connected,
        lastSeen: device.lastSeen ?? null,
        expires,
        daysToExpiry,
        tags: device.tags,
        addresses: device.addresses,
      };
    });
  }

  async devices(now = new Date()): Promise<TailscaleDevice[]> {
    return await this.listDevices(now);
  }
}
