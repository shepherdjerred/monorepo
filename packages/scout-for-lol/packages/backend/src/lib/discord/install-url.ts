import configuration from "#src/configuration.ts";

/** Permissions required for notifications and generated match reports. */
const BOT_INSTALL_PERMISSIONS = (
  (1n << 10n) |
  (1n << 11n) |
  (1n << 14n) |
  (1n << 15n)
).toString();

/**
 * Beta is the only Discord application with `/app/installed` registered as a
 * redirect URI. Handing a redirect the target app has not registered makes
 * Discord reject the install outright, so production gets a link without one —
 * mirroring `packages/app/src/lib/discord-invite.ts`, which makes the same
 * distinction for the browser-side invite button.
 */
const BETA_APPLICATION_ID = "1311755320745394317";

export function buildDiscordInstallUrl(): string {
  const origin = (
    configuration.webAppOrigin ?? "https://scout-for-lol.com"
  ).replace(/\/$/u, "");
  const params = new URLSearchParams({
    client_id: configuration.applicationId,
    scope: "bot applications.commands",
    permissions: BOT_INSTALL_PERMISSIONS,
  });
  if (configuration.applicationId === BETA_APPLICATION_ID) {
    params.set("redirect_uri", `${origin}/app/installed`);
  }
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}
