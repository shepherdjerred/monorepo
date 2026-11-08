import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { preparePrismInstance, waitForPrismDiscovery } from "#daemon/prism.ts";
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
