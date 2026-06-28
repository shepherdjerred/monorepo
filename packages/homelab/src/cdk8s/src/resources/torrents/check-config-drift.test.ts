import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The fail-on-drift guard mounted into the qBittorrent init container. It lives
// in the config seed dir (so addDirectory mounts it at /seed alongside the
// committed conf); the test references it there directly.
const scriptPath = path.join(
  import.meta.dir,
  "..",
  "configs",
  "qbittorrent",
  "check-config-drift.sh",
);

// A representative committed seed: the keys WE declare/manage.
const SEED = String.raw`[Application]
FileLogger\Enabled=true

[BitTorrent]
Session\Interface=wg0
Session\GlobalMaxRatio=1
Session\ExcludedFileNames=

[Preferences]
WebUI\Username=jerred
`;

// The live conf qBittorrent persists: the same managed keys PLUS keys the app
// writes on its own (the password hash, cookies) that we deliberately do not
// declare and must NOT be flagged as drift.
const LIVE_IN_SYNC = String.raw`[Application]
FileLogger\Enabled=true

[BitTorrent]
Session\Interface=wg0
Session\GlobalMaxRatio=1
Session\ExcludedFileNames=

[Network]
Cookies=@Invalid()

[Preferences]
WebUI\Username=jerred
WebUI\Password_PBKDF2="@ByteArray(abc==:def==)"
`;

let dir: string;

function write(name: string, content: string): string {
  const p = path.join(dir, name);
  // Synchronous so the file is on disk before the guard process reads it.
  writeFileSync(p, content);
  return p;
}

async function runGuard(
  seedPath: string,
  livePath: string,
): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(["sh", scriptPath, seedPath, livePath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const code = await proc.exited;
  const stderr = await new Response(proc.stderr).text();
  return { code, stderr };
}

describe("check-config-drift.sh", () => {
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "qbt-drift-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes when the live conf matches the committed managed keys", async () => {
    const seed = write("seed.conf", SEED);
    const live = write("live-sync.conf", LIVE_IN_SYNC);
    const { code } = await runGuard(seed, live);
    expect(code).toBe(0);
  });

  it("ignores runtime-only keys the app adds (password hash, cookies)", async () => {
    // LIVE_IN_SYNC contains Password_PBKDF2 + Cookies that the seed lacks; the
    // guard must still pass because those keys are not declared/managed.
    const seed = write("seed2.conf", SEED);
    const live = write("live-extra.conf", LIVE_IN_SYNC);
    const { code, stderr } = await runGuard(seed, live);
    expect(code).toBe(0);
    expect(stderr).not.toContain("Password_PBKDF2");
    expect(stderr).not.toContain("Cookies");
  });

  it("fails (exit 3) and names the key when a managed value drifts", async () => {
    const seed = write("seed3.conf", SEED);
    const live = write(
      "live-drift.conf",
      LIVE_IN_SYNC.replace(
        String.raw`Session\GlobalMaxRatio=1`,
        String.raw`Session\GlobalMaxRatio=5`,
      ),
    );
    const { code, stderr } = await runGuard(seed, live);
    expect(code).toBe(3);
    expect(stderr).toContain(String.raw`Session\GlobalMaxRatio`);
    expect(stderr).toContain("declared=<1>");
    expect(stderr).toContain("live=<5>");
  });

  it("fails (exit 3) when the live conf drops a managed key", async () => {
    const seed = write("seed4.conf", SEED);
    const live = write(
      "live-missing.conf",
      LIVE_IN_SYNC.replace("WebUI\\Username=jerred\n", ""),
    );
    const { code, stderr } = await runGuard(seed, live);
    expect(code).toBe(3);
    expect(stderr).toContain(String.raw`WebUI\Username`);
    expect(stderr).toContain("missing from live config");
  });

  it("passes when the live conf does not exist yet (fresh PVC)", async () => {
    const seed = write("seed5.conf", SEED);
    const { code } = await runGuard(seed, path.join(dir, "no-such-file.conf"));
    expect(code).toBe(0);
  });

  it("does not misclassify live keys when the seed is empty", async () => {
    // Guards the FNR==NR empty-first-file pitfall: an empty seed declares zero
    // managed keys, so nothing can drift.
    const seed = write("seed-empty.conf", "");
    const live = write("live-empty-seed.conf", LIVE_IN_SYNC);
    const { code } = await runGuard(seed, live);
    expect(code).toBe(0);
  });
});
