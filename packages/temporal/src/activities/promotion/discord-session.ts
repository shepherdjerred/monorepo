import path from "node:path";
import { z } from "zod/v4";
import { promotionTotp } from "./access/otp.ts";

const Identity = z.object({
  identities: z.object({
    user: z.object({ id: z.literal("1560536854556839948"), tag: z.string() }),
    bot: z.never().optional(),
  }),
});

/** Parent-owned login. Neither vault access nor inference credentials reach the daemon. */
let failedBatch: { id: string; error: Error } | undefined;

export async function ensurePromotionDiscord(
  login: Parameters<typeof bootstrapPromotionDiscord>[0],
  socket: string,
  batchId: string,
) {
  if (failedBatch?.id === batchId) throw failedBatch.error;
  try {
    await bootstrapPromotionDiscord(login, socket);
  } catch (error) {
    const failure =
      error instanceof Error ? error : new Error("Outreach bootstrap failed");
    failedBatch = { id: batchId, error: failure };
    throw failure;
  }
}

async function bootstrapPromotionDiscord(
  login: {
    username: string;
    email?: string | undefined;
    password: string;
    otp?: string | undefined;
  },
  socket: string,
) {
  const status = async () => {
    const response = await fetch("http://discord/status", {
      unix: socket,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error("Discord status unavailable");
    const identity = Identity.parse(await response.json());
    if (identity.identities.user.tag.replace(/#0$/, "") !== "the.storm.mc")
      throw new Error("Outreach identity mismatch");
  };
  const available = await Bun.file(
    path.join(path.dirname(socket), "state.json"),
  ).exists();
  if (available) {
    try {
      await status();
      return;
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        ["ENOENT", "ECONNREFUSED"].includes(String(error.code))
      ))
        throw error;
    }
  }
  const email = z.email().parse(login.email ?? login.username);
  const env: Record<string, string | undefined> = Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "LANG",
      "TZ",
      "NODE_EXTRA_CA_CERTS",
      "SSL_CERT_FILE",
    ].map((k) => [k, Bun.env[k]]),
  );
  env["TOOLKIT_DISCORD_DIR"] = path.dirname(socket);
  if (available) {
    const stopped = Bun.spawn(["toolkit", "discord", "daemon", "stop"], {
      env,
      stdout: "ignore",
      stderr: "ignore",
      stdin: "ignore",
    });
    if ((await stopped.exited) !== 0)
      throw new Error("Cannot reclaim stale outreach daemon");
  }
  Object.assign(env, {
    TOOLKIT_DISCORD_DIR: path.dirname(socket),
    DISCORD_USER_EMAIL: email,
    DISCORD_USER_PASSWORD: login.password,
  });
  if (login.otp !== undefined)
    env["DISCORD_USER_OTP_CODE"] = promotionTotp(login.otp);
  const child = Bun.spawn(
    [
      "toolkit",
      "discord",
      "daemon",
      "start",
      "--password-login",
      "--ttl",
      "30m",
    ],
    { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" },
  );
  const results = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (results[2] !== 0)
    throw new Error(
      "Outreach Discord bootstrap failed; private credential output withheld",
    );
  await status();
}
