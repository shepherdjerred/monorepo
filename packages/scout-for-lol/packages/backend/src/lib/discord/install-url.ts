import configuration from "#src/configuration.ts";

/** Permissions required for notifications and generated match reports. */
const BOT_INSTALL_PERMISSIONS = (
  (1n << 10n) |
  (1n << 11n) |
  (1n << 14n) |
  (1n << 15n)
).toString();

/**
 * `state` is the single-use install-attribution token minted by
 * handleDiscordInstall; Discord echoes it back to /app/installed alongside
 * `guild_id`, which is what joins a web session to the resulting
 * `GuildInstall` row (see analytics/install-attribution.ts). The `/invite`
 * slash command has no web session to attribute, so it omits it — those
 * installs are the measurable `guild_installed − guild_install_attributed`
 * residue.
 */
export function buildDiscordInstallUrl(state?: string): string {
  const origin = (
    configuration.webAppOrigin ?? "https://scout-for-lol.com"
  ).replace(/\/$/u, "");
  const params = new URLSearchParams({
    client_id: configuration.applicationId,
    // `bot`-only authorization is intentionally callback-less in Discord.
    // The small `identify` scope opts into the authorization-code flow so
    // Discord returns to Scout after the bot is installed.
    scope: "bot applications.commands identify",
    permissions: BOT_INSTALL_PERMISSIONS,
    redirect_uri: `${origin}/api/auth/discord/callback`,
    response_type: "code",
  });
  if (state !== undefined) {
    params.set("state", state);
  }
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}
