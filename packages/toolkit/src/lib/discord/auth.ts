import { z } from "zod";

export function discordDaemonEnvironment(
  source: Readonly<Record<string, string | undefined>>,
  mode: { passwordLogin: boolean; userOnly: boolean },
): Record<string, string> {
  if (mode.passwordLogin && mode.userOnly)
    throw new Error("Choose --password-login or --user-only, not both");
  const keys = [
    "PATH",
    "HOME",
    "TMPDIR",
    "LANG",
    "USER",
    "LOGNAME",
    "SHELL",
    "TERM",
    "TZ",
    "NODE_EXTRA_CA_CERTS",
    "SSL_CERT_FILE",
    "TOOLKIT_DISCORD_DIR",
    "TOOLKIT_DISCORD_TTL_SECONDS",
  ];
  if (mode.passwordLogin)
    keys.push("DISCORD_USER_EMAIL", "DISCORD_USER_PASSWORD");
  else {
    keys.push("DISCORD_USER_TOKEN");
    if (!mode.userOnly) keys.push("DISCORD_BOT_TOKEN");
  }
  return Object.fromEntries(
    keys.flatMap((key) =>
      source[key] === undefined ? [] : [[key, source[key]]],
    ),
  );
}

/** Password-manager credentials are exchanged in memory; challenges need operator action. */
export async function discordPasswordToken(
  email: string,
  password: string,
  request: (url: string, init: RequestInit) => Promise<Response> = fetch,
): Promise<string> {
  try {
    const response = await request("https://discord.com/api/v9/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        login: email,
        password,
        undelete: false,
        gift_code_sku_id: null,
        login_source: null,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    const parsed = z
      .object({ token: z.string().min(1) })
      .safeParse(await response.json());
    if (response.ok && parsed.success) return parsed.data.token;
  } catch {
    // Native HTTP errors can carry the credential-bearing request. Do not forward them.
  }
  throw new Error(
    "Discord credential login was rejected or requires interactive verification; no session was created",
  );
}
