import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LIVE_TIMEOUT_MS,
  DEFAULT_OFFLINE_TIMEOUT_MS,
  DOCKER_PREFLIGHT_TIMEOUT_MS,
  parseBazarrProviderArgs,
  preflightDockerDaemon,
  runBazarrProviders,
} from "./test-bazarr-providers.ts";

const createdScratchRoots = new Set<string>();

afterEach(async () => {
  for (const scratchRoot of createdScratchRoots) {
    await rm(scratchRoot, { recursive: true, force: true });
    createdScratchRoots.delete(scratchRoot);
  }
});

async function makeTempDir(prefix: string): Promise<string> {
  const created = await mkdtemp(path.join(tmpdir(), prefix));
  createdScratchRoots.add(created);
  return created;
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("test-bazarr-providers", () => {
  it("selects 120s offline, 300s --live, and honors --timeout-ms overrides", async () => {
    expect(DOCKER_PREFLIGHT_TIMEOUT_MS).toBe(5000);
    const offline = await parseBazarrProviderArgs([]);
    expect(offline.timeoutMs).toBe(DEFAULT_OFFLINE_TIMEOUT_MS);
    expect(offline.timeoutMs).toBe(120_000);

    const live = await parseBazarrProviderArgs(
      [
        "--live",
        "--browser-url",
        "http://127.0.0.1:9867",
        "--browser-config",
        "/tmp/unused-when-token-present.json",
        "--release",
        "Show.S01E01",
        "--series",
        "Show",
        "--season",
        "1",
        "--episode",
        "1",
      ],
      { PINCHTAB_TOKEN: "fixture-token" },
    );
    expect(live.timeoutMs).toBe(DEFAULT_LIVE_TIMEOUT_MS);
    expect(live.timeoutMs).toBe(300_000);

    const overridden = await parseBazarrProviderArgs(["--timeout-ms", "15000"]);
    expect(overridden.timeoutMs).toBe(15_000);
  });

  it("kills a wedged `docker info` preflight child and reports an actionable OrbStack/Docker socket message", async () => {
    const dir = await makeTempDir("bazarr-preflight-hang-");
    const pidFile = path.join(dir, "docker.pid");
    const fakeDocker = path.join(dir, "docker");
    await Bun.write(
      fakeDocker,
      `#!${process.execPath}
import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 10_000);
`,
    );
    await chmod(fakeDocker, 0o755);

    await expect(
      preflightDockerDaemon({
        env: { ...Bun.env, PATH: `${dir}:${Bun.env["PATH"] ?? ""}` },
        timeoutMs: 300,
      }),
    ).rejects.toThrow(/Docker preflight timed out.*OrbStack.*docker\.sock/u);

    const pidText = await Bun.file(pidFile).text();
    const recordedPid = Number(pidText.trim());
    expect(Number.isInteger(recordedPid)).toBe(true);
    expect(isPidAlive(recordedPid)).toBe(false);
  });

  it("kills a wedged `docker run` child on execution deadline after preflight succeeds", async () => {
    const dir = await makeTempDir("bazarr-run-hang-");
    const pidFile = path.join(dir, "docker-run.pid");
    const fakeDocker = path.join(dir, "docker");
    await Bun.write(
      fakeDocker,
      String.raw`#!${process.execPath}
import { writeFileSync } from "node:fs";
if (process.argv[2] === "info") {
  process.stdout.write("28.0.1\n");
  process.exit(0);
}
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
setInterval(() => {}, 10_000);
`,
    );
    await chmod(fakeDocker, 0o755);

    await expect(
      runBazarrProviders(["--timeout-ms", "300"], {
        env: { ...Bun.env, PATH: `${dir}:${Bun.env["PATH"] ?? ""}` },
        preflightTimeoutMs: 1000,
        stdio: "pipe",
      }),
    ).rejects.toThrow(
      /Bazarr provider container timed out after 300ms.*--timeout-ms.*OrbStack/u,
    );

    const pidText = await Bun.file(pidFile).text();
    const recordedPid = Number(pidText.trim());
    expect(Number.isInteger(recordedPid)).toBe(true);
    expect(isPidAlive(recordedPid)).toBe(false);
  });
});
