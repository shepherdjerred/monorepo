import configuration from "#src/configuration.ts";

/** Permissions required for notifications and generated match reports. */
const BOT_INSTALL_PERMISSIONS = (
  (1n << 10n) |
  (1n << 11n) |
  (1n << 14n) |
  (1n << 15n)
).toString();

export function buildDiscordInstallUrl(): string {
  const origin = (
    configuration.webAppOrigin ?? "https://scout-for-lol.com"
  ).replace(/\/$/u, "");
  const params = new URLSearchParams({
    client_id: configuration.applicationId,
    scope: "bot applications.commands",
    permissions: BOT_INSTALL_PERMISSIONS,
    redirect_uri: `${origin}/app/installed`,
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}
