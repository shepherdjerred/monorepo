import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { LocalScoutTerrainManifestSchema } from "./local-scout-terrain-manifest.ts";
import { replayPath } from "./recorded-replay-data.ts";

const port = z.coerce
  .number()
  .int()
  .min(1)
  .max(65_535)
  .parse(Bun.env["SCOUT_REPLAY_E2E_PORT"] ?? "5195");
const origin = `http://127.0.0.1:${String(port)}`;
const config = "e2e/public-replay/recorded-vite.config.ts";
const build = `bun run build --config ${config}`;
const preview = `bun e2e/public-replay/recorded-preview.ts ${String(port)}`;
const withAnnouncer = Bun.env["SCOUT_REPLAY_E2E_WITH_ANNOUNCER"] === "1";
const manifest = Bun.env["SCOUT_REPLAY_E2E_MANIFEST"];
const mapId =
  manifest === undefined || manifest === ""
    ? 11
    : LocalScoutTerrainManifestSchema.parse(await Bun.file(manifest).json())
        .capabilities.mapId;
const tests =
  mapId === 12
    ? ["recorded-mayhem.pw.ts"]
    : ["recorded-replay.pw.ts", "recorded-neutral.pw.ts"];
if (withAnnouncer) tests.push("recorded-announcer.pw.ts");

export default defineConfig({
  testDir: ".",
  testMatch: tests,
  workers: 1,
  outputDir: "../../test-results/recorded-replay",
  timeout: 180_000,
  expect: { timeout: 60_000 },
  webServer: {
    command:
      Bun.env["SCOUT_REPLAY_E2E_REUSE_DIST"] === "1"
        ? preview
        : `${build} && ${preview}`,
    cwd: fileURLToPath(new URL("../..", import.meta.url)),
    url: `${origin}${replayPath}`,
    timeout: 180_000,
  },
  use: {
    baseURL: origin,
    serviceWorkers: "block",
    viewport: { width: 1280, height: 900 },
    launchOptions: {
      args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
    },
  },
});
