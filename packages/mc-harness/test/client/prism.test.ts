import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gradleLaunchArgs } from "#daemon/client-launch.ts";
import {
  createPrismMemoryMonitor,
  preparePrismInstance,
  prismControlInstanceName,
  prismControlLaunchArgs,
  waitForPrismDiscovery,
  watchPrismMemoryPrompt,
} from "#daemon/prism.ts";
import {
  caffeinateArgs,
  cleanupPrismCaptureInstance,
} from "#daemon/prism-launcher.ts";
import { ClientStartRequestSchema } from "#protocol/client.ts";
import { assessLiveWrite, type LiveGuardConfig } from "#src/live/guard.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "prism-test-"));
  dirs.push(dir);
  const stagedMods = path.join(dir, "staged");
  await mkdir(stagedMods);
  await writeFile(
    path.join(stagedMods, "metadata.json"),
    JSON.stringify({
      minecraft: "26.3",
      fabricLoader: "0.19.5",
      clientJar: "client.jar",
    }),
  );
  await writeFile(path.join(stagedMods, "client.jar"), "client");
  await writeFile(path.join(stagedMods, "fabric-api.jar"), "api");
  return { dir, stagedMods, bootstrap: "/tmp/storm-test/bootstrap.json" };
}

describe("authenticated Prism control", () => {
  it("waits for Prism to discover a new instance", async () => {
    const { dir } = await fixture();
    const log = path.join(dir, "launcher.log");
    await writeFile(
      log,
      'old log\nLoaded instance "The Storm (controlled)" from "/instances/StormControl"\n',
    );
    const priorLog = await readFile(log);
    const offset = priorLog.length;
    const ready = waitForPrismDiscovery(log, offset);
    await writeFile(
      log,
      'Loaded instance "The Storm (controlled)" from "/instances/StormControl"\n',
      { flag: "a" },
    );
    await expect(ready).resolves.toBeUndefined();
  });
  it("stages an isolated instance without reading or copying accounts", async () => {
    const { dir, stagedMods, bootstrap } = await fixture();
    const account = path.join(dir, "accounts.json");
    await writeFile(account, "account data");
    await preparePrismInstance({ root: dir, stagedMods, bootstrap });
    const instance = path.join(dir, "instances", "StormControl");
    expect(await readFile(account, "utf8")).toBe("account data");
    expect(
      await readFile(path.join(instance, "instance.cfg"), "utf8"),
    ).toContain(`-Dstorm.client.session=${bootstrap}`);
    expect(
      await readFile(
        path.join(instance, "minecraft/mods/storm-client.jar"),
        "utf8",
      ),
    ).toBe("client");
    const pack = JSON.parse(
      await readFile(path.join(instance, "mmc-pack.json"), "utf8"),
    );
    expect(pack.components.map((part: { uid: string }) => part.uid)).toEqual([
      "net.minecraft",
      "net.fabricmc.fabric-loader",
    ]);
  });

  it("refuses to overwrite an unmanaged instance", async () => {
    const { dir, stagedMods, bootstrap } = await fixture();
    await mkdir(path.join(dir, "instances", "StormControl"), {
      recursive: true,
    });
    await expect(
      preparePrismInstance({ root: dir, stagedMods, bootstrap }),
    ).rejects.toThrow("unmanaged");
  });

  it("prepares a named capture instance from pinned metadata without a user template", async () => {
    const { dir, stagedMods, bootstrap } = await fixture();
    const instanceName = "storm-capture-test";
    await preparePrismInstance({
      root: dir,
      stagedMods,
      bootstrap,
      instanceName,
    });
    const instance = path.join(dir, "instances", instanceName);
    const pack = JSON.parse(
      await readFile(path.join(instance, "mmc-pack.json"), "utf8"),
    );
    expect(pack.components).toEqual([
      { uid: "net.minecraft", version: "26.3", important: true },
      { uid: "net.fabricmc.fabric-loader", version: "0.19.5" },
    ]);
    expect(
      await readFile(
        path.join(instance, "minecraft/mods/fabric-api.jar"),
        "utf8",
      ),
    ).toBe("api");
    await rm(path.join(instance, "storm-control-owned"));
    await expect(
      preparePrismInstance({ root: dir, stagedMods, bootstrap, instanceName }),
    ).rejects.toThrow("unmanaged");
  });

  it("rejects instance names that escape the owned instance directory", async () => {
    const { dir, stagedMods, bootstrap } = await fixture();
    await expect(
      preparePrismInstance({
        root: dir,
        stagedMods,
        bootstrap,
        instanceName: "../foreign",
      }),
    ).rejects.toThrow();
  });

  it("requires explicit live target and refuses live privilege changes", () => {
    expect(
      ClientStartRequestSchema.parse({ target: "live", name: "Tester" }).op,
    ).toBe(false);
    expect(
      ClientStartRequestSchema.safeParse({
        target: "live",
        name: "Tester",
        op: true,
      }).success,
    ).toBe(false);
    expect(
      ClientStartRequestSchema.safeParse({
        target: "live",
        name: "Tester",
        gameMode: "CREATIVE",
      }).success,
    ).toBe(false);
    expect(
      ClientStartRequestSchema.safeParse({
        target: "elsewhere",
        name: "Tester",
      }).success,
    ).toBe(false);
  });

  it("rejects live block interactions that can have wider effects", () => {
    const config: LiveGuardConfig = {
      writes: true,
      worlds: ["world"],
      maxRegionVolume: 100,
      nearPlayerRadius: 32,
      maxSnapshotVolume: 100,
      protectedRegions: [],
    };
    expect(() =>
      assessLiveWrite(
        {
          kind: "client-action",
          name: "Tester",
          action: "use",
          world: "world",
          pos: { x: 1, y: 2, z: 3 },
        },
        config,
      ),
    ).toThrow("Unsupported live client action");
  });
});

describe("parallel Prism session isolation", () => {
  it("isolates per-session Prism names, Gradle cache dirs, caffeinate watchdog, and failed capture cleanup", async () => {
    const { dir, stagedMods, bootstrap } = await fixture();
    const firstName = prismControlInstanceName("Alpha", "1111aaaa");
    const secondName = prismControlInstanceName("Beta", "2222bbbb");
    expect(firstName).toBe("storm-control-alpha-1111aaaa");
    expect(secondName).toBe("storm-control-beta-2222bbbb");
    expect(firstName).not.toBe(secondName);

    const log = path.join(dir, "prism-session.log");
    await writeFile(log, "initial\n");
    const initialLog = await readFile(log);
    const offset = initialLog.length;
    const discovery = waitForPrismDiscovery(log, offset, firstName);
    await writeFile(
      log,
      `Loaded instance "The Storm (controlled)" from "/instances/${firstName}"\n`,
      { flag: "a" },
    );
    await expect(discovery).resolves.toBeUndefined();

    expect(caffeinateArgs(9876)).toEqual([
      "/usr/bin/caffeinate",
      "-du",
      "-w",
      "9876",
    ]);

    const launchArgv = gradleLaunchArgs({
      repoRoot: "/repo",
      bootstrapPath: "/tmp/mc-client-xyz/bootstrap.json",
      bootstrap: {
        socket: "/tmp/mc-client-xyz/client.sock",
        artifacts: "/tmp/artifacts",
        server: "127.0.0.1:25565",
      },
      gameDir: "/tmp/mc-client-xyz/game",
      username: "CameraA",
      logPath: "/tmp/artifacts/client.log",
    });
    expect(launchArgv).toContain("--project-cache-dir");
    expect(launchArgv).toContain("/tmp/mc-client-xyz/gradle-cache");

    const captureName = "storm-capture-fail-case";
    await preparePrismInstance({
      root: dir,
      stagedMods,
      bootstrap,
      instanceName: captureName,
    });
    const captureInstanceDir = path.join(dir, "instances", captureName);
    const optionsTxt = await readFile(
      path.join(captureInstanceDir, "minecraft/options.txt"),
      "utf8",
    );
    expect(optionsTxt).toContain("pauseOnLostFocus:false");
    expect(optionsTxt).toContain('inactivityFpsLimit:"minimized"');

    await mkdir(path.join(captureInstanceDir, "minecraft/logs"), {
      recursive: true,
    });
    await writeFile(
      path.join(captureInstanceDir, "minecraft/logs/latest.log"),
      "fatal render error\n",
    );
    const artifactsDir = path.join(dir, "artifacts");
    await cleanupPrismCaptureInstance({
      instanceDir: captureInstanceDir,
      artifactsDir,
      completed: false,
    });
    expect(
      await readFile(
        path.join(artifactsDir, "prism-diagnostics/logs/latest.log"),
        "utf8",
      ),
    ).toBe("fatal render error\n");
    expect(
      await Bun.file(path.join(captureInstanceDir, "instance.cfg")).exists(),
    ).toBe(false);
  });
});

describe("Prism profile selection and memory-pressure prompt detection", () => {
  it("passes the requested session name as --profile when launching a controlled instance", () => {
    expect(
      prismControlLaunchArgs(
        "/Applications/Prism Launcher.app/Contents/MacOS/prismlauncher",
        "storm-control-xiguajerred-1234abcd",
        "XiguaJerred",
      ),
    ).toEqual([
      "/Applications/Prism Launcher.app/Contents/MacOS/prismlauncher",
      "--launch",
      "storm-control-xiguajerred-1234abcd",
      "--profile",
      "XiguaJerred",
    ]);
  });

  it("fails fast with an actionable diagnostic when EnsureAvailableMemory stalls in PrismLauncher-0.log", async () => {
    const { dir } = await fixture();
    const logPath = path.join(dir, "PrismLauncher-0.log");
    await writeFile(logPath, "0.001 D Prior launch entry\n");
    const initial = await readFile(logPath);
    const offset = initial.length;
    let clock = 1000;
    const monitor = createPrismMemoryMonitor({
      logPath,
      offset,
      graceMs: 3000,
      now: () => clock,
    });

    await writeFile(
      logPath,
      '1.234 D Task "EnsureAvailableMemory(0x600001)" starting\n',
      { flag: "a" },
    );
    await expect(monitor.poll()).resolves.toBeUndefined();
    clock = 3999;
    await expect(monitor.poll()).resolves.toBeUndefined();
    clock = 4000;
    await expect(monitor.poll()).rejects.toThrow(
      /memory-pressure confirmation dialog \(EnsureAvailableMemory\)/u,
    );
  });

  it("clears the EnsureAvailableMemory timer once the check succeeds or aborted is logged", async () => {
    const { dir } = await fixture();
    const logPath = path.join(dir, "PrismLauncher-0.log");
    await writeFile(logPath, "");
    let clock = 100;
    const monitor = createPrismMemoryMonitor({
      logPath,
      offset: 0,
      graceMs: 3000,
      now: () => clock,
    });

    await writeFile(
      logPath,
      '1.000 D Task "EnsureAvailableMemory(0x1)" starting\n',
      { flag: "a" },
    );
    await expect(monitor.poll()).resolves.toBeUndefined();
    clock = 1500;
    await writeFile(
      logPath,
      '2.500 D Task "EnsureAvailableMemory(0x1)" succeeded\n',
      { flag: "a" },
    );
    await expect(monitor.poll()).resolves.toBeUndefined();
    clock = 10_000;
    await expect(monitor.poll()).resolves.toBeUndefined();

    const abortController = new AbortController();
    const afterSuccess = await readFile(logPath);
    const stalledWatch = watchPrismMemoryPrompt({
      logPath,
      offset: afterSuccess.length,
      socketPath: path.join(dir, "missing.sock"),
      signal: abortController.signal,
      graceMs: 40,
      pollMs: 10,
    });
    await writeFile(
      logPath,
      '3.000 D Task "EnsureAvailableMemory(0x2)" starting\n',
      { flag: "a" },
    );
    await expect(stalledWatch).rejects.toThrow("EnsureAvailableMemory");
  });
});
