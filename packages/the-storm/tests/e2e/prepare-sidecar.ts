import { chmod, chown, cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { RconClient } from "#e2e/harness/rcon.ts";
import { stagePlugins } from "./harness/server.ts";
import { e2eProfile, gameplayFixtures } from "./gameplay-fixtures.ts";
import { paper } from "@shepherdjerred/mc-harness/pins.ts";

const packageRoot = path.resolve(import.meta.dirname, "..", "..");
const profile = e2eProfile();
const full = profile !== "e2e";
const stormJar = path.join(
  packageRoot,
  "plugin",
  "dist",
  "build",
  "libs",
  "TheStorm.jar",
);
const ownedConfigDir = path.join(packageRoot, "server/owned/plugins/TheStorm");
const pluginVolume = Bun.env["STORM_E2E_PLUGIN_DIR"];
const dataVolume = Bun.env["STORM_E2E_DATA_DIR"];
const rconPassword = Bun.env["STORM_E2E_RCON_PASSWORD"];
const rconHost = Bun.env["STORM_E2E_RCON_HOST"] ?? "127.0.0.1";
const brainHost = Bun.env["STORM_E2E_BRAIN_HOST"];
const brainPort = Number(Bun.env["STORM_E2E_BRAIN_PORT"]);
const brainToken = Bun.env["STORM_E2E_BRAIN_TOKEN"];
if (
  brainToken === undefined ||
  pluginVolume === undefined ||
  dataVolume === undefined ||
  rconPassword === undefined ||
  brainHost === undefined ||
  !Number.isInteger(brainPort) ||
  brainPort <= 0
) {
  throw new Error(
    "Storm E2E plugin/data paths, RCON password, and fake brain settings are required",
  );
}

const cacheDir = path.join(packageRoot, ".cache", "e2e");
const workspaceDir = path.dirname(pluginVolume);
await Bun.write(path.join(workspaceDir, "brain.start"), "start\n");
const stagingDir = path.join(
  cacheDir,
  "runs",
  `sidecar-${process.pid.toString()}`,
);
const stagedPlugins = await stagePlugins(cacheDir, stagingDir, {
  stormJar,
  ...(await gameplayFixtures(packageRoot, profile)),
  ownedConfigDir,
  brain: {
    baseUrl: `http://${brainHost}:${brainPort.toString()}`,
    token: brainToken,
  },
  sweep: {
    intervalMinutes: 1,
    redriveAfterMinutes: 0,
    redriveBackoffMinutes: 0,
    slaAfterMinutes: 10_080,
  },
  agent: { mode: full ? "active" : "shadow", reviewSamplePercent: 100 },
  warmCache: false,
});
await rm(pluginVolume, { recursive: true, force: true });
await rm(dataVolume, { recursive: true, force: true });
await mkdir(pluginVolume, { recursive: true });
await mkdir(dataVolume, { recursive: true });
await cp(stagedPlugins, pluginVolume, { recursive: true });
await mkdir(path.join(dataVolume, "logs"), { recursive: true });
// The runner creates this shared directory as root; Paper writes as uid 1000.
await chown(path.join(dataVolume, "logs"), 1000, 1000);
await chmod(path.join(dataVolume, "logs"), 0o770);
// The suite reconnects disposable players faster than Bukkit's default throttle.
await mkdir(path.join(dataVolume, "config"), { recursive: true });
await Bun.write(
  path.join(dataVolume, "config", "bukkit.yml"),
  "settings:\n  connection-throttle: -1\n",
);

const brainDeadline = Date.now() + 60_000;
for (;;) {
  try {
    const response = await fetch(
      `http://${brainHost}:${brainPort.toString()}/v1/__control`,
      { signal: AbortSignal.timeout(1000) },
    );
    if (response.ok) break;
  } catch {
    // The service starts after dependency installation; poll until it is up.
  }
  if (Date.now() >= brainDeadline) {
    throw new Error(
      "Fake brain service did not become ready within 60 seconds",
    );
  }
  await Bun.sleep(500);
}
await Bun.write(path.join(pluginVolume, ".ready"), "ready\n");

const deadline = Date.now() + 300_000;
const logFile = path.join(dataVolume, "logs", "latest.log");
for (;;) {
  const logs = await Bun.file(logFile)
    .text()
    .catch(() => "");
  if (!logs.includes("Done (")) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Paper sidecar did not finish startup before timeout\n${(logs || "<no server log>").slice(-8000)}`,
      );
    }
    await Bun.sleep(1000);
    continue;
  }
  try {
    const client = await RconClient.connect({
      host: rconHost,
      port: 25_575,
      password: rconPassword,
      timeoutMs: 2000,
    });
    client.close();
    break;
  } catch (error) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Paper sidecar did not accept RCON before timeout: ${String(error)}\n${logs.slice(-8000)}`,
        { cause: error },
      );
    }
    await Bun.sleep(1000);
  }
}

console.warn(`Paper ${paper.version} sidecar is ready on RCON`);
