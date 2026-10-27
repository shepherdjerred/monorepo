import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod/v4";
import { stat } from "node:fs/promises";
import { PromotionLoginsSchema } from "#activities/promotion/tools.ts";

if (Bun.env["OP_SERVICE_ACCOUNT_TOKEN"] !== undefined)
  throw new Error(
    "Start with env -u OP_SERVICE_ACCOUNT_TOKEN after service-account injection",
  );
const directory = path.join(homedir(), ".toolkit/discord/storm-promotion");
const socket = path.join(directory, "daemon.sock");
const expectedUsername = "the.storm.mc";
async function status() {
  const response = await fetch("http://discord/status", {
    unix: socket,
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error("Outreach Discord status failed");
  const current = z
    .object({
      identities: z.object({
        user: z.object({ tag: z.string(), id: z.string() }),
        bot: z.unknown().optional(),
      }),
    })
    .parse(await response.json());
  if (
    current.identities.bot !== undefined ||
    current.identities.user.tag.replace(/#0$/, "") !== expectedUsername
  )
    throw new Error(
      "Outreach Discord identity mismatch; no channel operations performed",
    );
  return current.identities.user;
}
async function toolkit(operation: string, passwordLogin = false) {
  const inherited = [
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
  ];
  const env: Record<string, string | undefined> = Object.fromEntries(
    inherited.map((name) => [name, Bun.env[name]]),
  );
  env["TOOLKIT_DISCORD_DIR"] = directory;
  if (passwordLogin) {
    env["DISCORD_USER_EMAIL"] = Bun.env["DISCORD_USER_EMAIL"];
    env["DISCORD_USER_PASSWORD"] = Bun.env["DISCORD_USER_PASSWORD"];
  }
  const child = Bun.spawn(
    [
      "bun",
      "packages/toolkit/src/index.ts",
      "discord",
      "daemon",
      operation,
      ...(passwordLogin ? ["--password-login", "--ttl", "2h"] : []),
    ],
    { env, stdin: "ignore", stdout: "pipe", stderr: "pipe" },
  );
  const results = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (results[2] !== 0)
    throw new Error(
      `Outreach Discord ${operation} failed; inspect its redacted daemon log`,
    );
}
const existing = await stat(socket).catch((error: unknown) => {
  if (error instanceof Error && "code" in error && error.code === "ENOENT")
    return;
  throw error;
});
if (existing?.isSocket() === true) {
  process.stdout.write(
    `${JSON.stringify({ started: false, user: await status(), socket })}\n`,
  );
} else {
  const logins = PromotionLoginsSchema.parse(
    JSON.parse(z.string().min(1).parse(Bun.env["STORM_PROMOTION_LOGINS"])),
  );
  const login = logins["discord"];
  if (login === undefined)
    throw new Error(
      "Outreach Discord login is absent from the service-account login map; desktop 1Password is disabled",
    );
  const email = login.email ?? login.username;
  z.email().parse(email);
  Bun.env["DISCORD_USER_EMAIL"] = email;
  Bun.env["DISCORD_USER_PASSWORD"] = login.password;
  try {
    await toolkit("start", true);
    try {
      process.stdout.write(
        `${JSON.stringify({ started: true, user: await status(), socket })}\n`,
      );
    } catch (error) {
      await toolkit("stop");
      throw error;
    }
  } finally {
    delete Bun.env["DISCORD_USER_EMAIL"];
    delete Bun.env["DISCORD_USER_PASSWORD"];
  }
}
