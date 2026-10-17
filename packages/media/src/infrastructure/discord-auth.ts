import { z } from "zod";
import type { DiscordIdentityProvider } from "#application/notification-ports.ts";
import { MediaError } from "#application/errors.ts";

export class DiscordOAuth implements DiscordIdentityProvider {
  constructor(
    private readonly options: {
      clientId: string;
      clientSecret: string;
      redirectUri: string;
    },
    private readonly request: typeof fetch = fetch,
  ) {}

  authorizationUrl(state: string): string {
    const url = new URL("https://discord.com/oauth2/authorize");
    url.search = new URLSearchParams({
      client_id: this.options.clientId,
      response_type: "code",
      redirect_uri: this.options.redirectUri,
      scope: "identify",
      state,
    }).toString();
    return url.toString();
  }

  async exchangeCode(code: string): Promise<{ id: string }> {
    const response = await this.request(
      "https://discord.com/api/oauth2/token",
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: this.options.clientId,
          client_secret: this.options.clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: this.options.redirectUri,
        }),
      },
    );
    if (!response.ok)
      throw new MediaError(
        "discord_authorization_failed",
        "Discord authorization failed; start linking again",
        502,
      );
    const token = z
      .object({ access_token: z.string(), token_type: z.literal("Bearer") })
      .parse(await response.json());
    const identity = await this.request(
      "https://discord.com/api/v10/users/@me",
      {
        headers: { Authorization: `Bearer ${token.access_token}` },
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!identity.ok)
      throw new MediaError(
        "discord_identity_failed",
        "Could not verify the Discord account",
        502,
      );
    return z
      .object({ id: z.string().regex(/^\d+$/) })
      .parse(await identity.json());
  }
}
