import path from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";
import { StatsSchema } from "@arcade/common/stats.ts";
import { games } from "@arcade/common/catalog.ts";
import { runtimeEnvironment } from "./runtime/environment.ts";

const root = await mkdtemp(path.join(tmpdir(), "arcade-smoke-"));
const config = path.join(root, "arcade.toml");
const origin = "http://127.0.0.1:18081";
await Bun.write(
  config,
  `controllerActive = false\nport = 18081\ndatabasePath = "${root}/arcade.db"\nstateRoot = "${root}/saves"\n`,
);
const child = Bun.spawn(
  [process.execPath, path.join(import.meta.dirname, "index.ts")],
  {
    env: {
      ...runtimeEnvironment(),
      FEATURE_FLAGS_MODE: "disabled",
      ARCADE_CONFIG_PATH: config,
      WEB_PUBLIC_ORIGIN: origin,
      DISCORD_CLIENT_SECRET: "synthetic-smoke-credential",
      DISCORD_BOT_TOKEN: "synthetic-smoke-bot-token",
      DISCORD_APPLICATION_ID: "123",
      DISCORD_STREAMING_TOKENS: '["synthetic-smoke-stream-token"]',
    },
    stdout: "inherit",
    stderr: "inherit",
  },
);
let exitCode: number;
try {
  const signal = AbortSignal.timeout(45_000);
  let healthy = false;
  while (!healthy) {
    signal.throwIfAborted();
    if (child.exitCode !== null)
      throw new Error("Arcade exited before becoming healthy");
    healthy = await fetch(`${origin}/health`, { signal })
      .then((response) => response.ok)
      .catch(() => false);
    if (!healthy) await Bun.sleep(100);
  }
  const page = await fetch(origin, { signal });
  const html = await page.text();
  if (!page.ok || !html.includes('id="root"'))
    throw new Error("Arcade did not serve its UI");
  for (const gameId of Object.keys(games)) {
    const response = await fetch(
      `${origin}/api/stats?guildId=123&gameId=${gameId}`,
      { signal },
    );
    if (!response.ok) throw new Error(`Arcade stats failed for ${gameId}`);
    StatsSchema.parse(await response.json());
  }
} finally {
  child.kill("SIGTERM");
  exitCode = await child.exited;
  await rm(root, { recursive: true, force: true });
}
if (exitCode !== 0) throw new Error("Arcade did not shut down cleanly");
