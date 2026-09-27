import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { RconClient } from "./harness/rcon.ts";
import { stagePlugins, stormSmokeConfig } from "./harness/server.ts";
import { paper } from "./harness/pins.ts";

const packageRoot = path.resolve(import.meta.dirname, "..", "..");
const stormJar = path.join(
  packageRoot,
  "plugin",
  "dist",
  "build",
  "libs",
  "TheStorm.jar",
);
const ownedConfig = path.join(
  packageRoot,
  "server",
  "owned",
  "plugins",
  "TheStorm",
  "config.yml",
);
const pluginVolume = Bun.env["STORM_E2E_PLUGIN_DIR"];
const dataVolume = Bun.env["STORM_E2E_DATA_DIR"];
const rconPassword = Bun.env["STORM_E2E_RCON_PASSWORD"];
if (
  pluginVolume === undefined ||
  dataVolume === undefined ||
  rconPassword === undefined
) {
  throw new Error(
    "STORM_E2E_PLUGIN_DIR, DATA_DIR, and RCON_PASSWORD are required",
  );
}

const cacheDir = path.join(packageRoot, ".cache", "e2e");
const stagingDir = path.join(
  cacheDir,
  "runs",
  `sidecar-${process.pid.toString()}`,
);
const stagedPlugins = await stagePlugins(cacheDir, stagingDir, {
  stormJar,
  stormConfig: stormSmokeConfig(await Bun.file(ownedConfig).text()),
  warmCache: false,
});
await mkdir(pluginVolume, { recursive: true });
await mkdir(dataVolume, { recursive: true });
await cp(stagedPlugins, pluginVolume, { recursive: true });
await Bun.write(path.join(pluginVolume, ".ready"), "ready\n");

const deadline = Date.now() + 300_000;
for (;;) {
  try {
    const client = await RconClient.connect({
      host: "127.0.0.1",
      port: 25_575,
      password: rconPassword,
      timeoutMs: 2000,
    });
    await client.command("list");
    client.close();
    break;
  } catch (error) {
    if (Date.now() >= deadline) {
      const logFile = path.join(dataVolume, "logs", "latest.log");
      const logs = await Bun.file(logFile)
        .text()
        .catch(() => "<no server log>");
      throw new Error(
        `Paper sidecar did not answer RCON before timeout: ${String(error)}\n${logs.slice(-8000)}`,
        { cause: error },
      );
    }
    await Bun.sleep(1000);
  }
}

console.warn(`Paper ${paper.version} sidecar is ready on RCON`);
