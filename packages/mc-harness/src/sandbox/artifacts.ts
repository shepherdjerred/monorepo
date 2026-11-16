/**
 * Pinned files a disposable Paper server needs, staged on the host before any
 * provider starts it: the Paper jar, third-party plugin jars, and a
 * throttle-free bukkit.yml. Provider independent; the-storm's E2E harness
 * uses the same helpers.
 */
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { Database } from "bun:sqlite";
import { paper, type PluginPin } from "#src/pins.ts";

/** The pinned Paper jar as seeded into `/data`; `basePaperEnv("seeded")` points the image at it. */
export const paperJarName = `paper-${paper.version}-${paper.build.toString()}.jar`;

const DOWNLOAD_LOCK_TIMEOUT_MS = 300_000;
const DOWNLOAD_LOCK_POLL_MS = 50;

/**
 * Bukkit throttles reconnects from one address for 4s by default, which breaks
 * back-to-back joins from a test runner on the same host.
 */
export async function writeThrottleFreeBukkitYml(file: string): Promise<void> {
  await Bun.write(file, "settings:\n  connection-throttle: -1\n");
  await chmod(file, 0o666);
}

async function download(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed: ${response.status.toString()}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function isSqliteBusy(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "SQLITE_BUSY" || error.code === "SQLITE_LOCKED")
  );
}

/**
 * Serializes concurrent cache downloads across worktree daemons and in-process
 * callers using an OS-backed SQLite exclusive transaction lock.
 */
async function withArtifactDownloadLock<T>(
  file: string,
  action: () => Promise<T>,
): Promise<T> {
  await mkdir(path.dirname(file), { recursive: true });
  const lockFile = `${file}.lock.sqlite`;
  const deadline = Date.now() + DOWNLOAD_LOCK_TIMEOUT_MS;
  for (;;) {
    const lock = new Database(lockFile, { create: true });
    let acquired = false;
    try {
      lock.run("PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE");
      acquired = true;
      return await action();
    } catch (error) {
      if (!acquired && isSqliteBusy(error) && Date.now() < deadline) {
        lock.close(false);
        await Bun.sleep(DOWNLOAD_LOCK_POLL_MS);
        continue;
      }
      throw error;
    } finally {
      if (acquired) {
        lock.close(false);
      }
    }
  }
}

function verifyDigest(
  file: string,
  bytes: Uint8Array,
  expectedSha256: string,
): void {
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== expectedSha256) {
    throw new Error(
      `${path.basename(file)} sha256 mismatch: expected ${expectedSha256}, got ${actual}`,
    );
  }
}

/** Downloads once into the shared cache under a cross-process lock and verifies sha256 on every run. */
export async function ensureArtifact(
  file: string,
  pin: Pick<PluginPin, "url" | "sha256">,
  fetcher: (url: string) => Promise<Uint8Array> = download,
): Promise<void> {
  const initial = Bun.file(file);
  if (await initial.exists()) {
    verifyDigest(file, new Uint8Array(await initial.arrayBuffer()), pin.sha256);
    return;
  }
  await withArtifactDownloadLock(file, async () => {
    const cached = Bun.file(file);
    if (await cached.exists()) {
      verifyDigest(
        file,
        new Uint8Array(await cached.arrayBuffer()),
        pin.sha256,
      );
      return;
    }
    const bytes = await fetcher(pin.url);
    verifyDigest(file, bytes, pin.sha256);
    const tempFile = `${file}.${process.pid.toString()}.${randomUUID()}.tmp`;
    try {
      await Bun.write(tempFile, bytes);
      await rename(tempFile, file);
    } catch (error) {
      await rm(tempFile, { force: true });
      throw error;
    }
  });
}

/** Copies each pinned jar (downloaded once into `downloadsDir`) into `pluginsDir`. */
export async function stagePinnedPlugins(
  downloadsDir: string,
  pluginsDir: string,
  pins: readonly Pick<PluginPin, "name" | "version" | "url" | "sha256">[],
): Promise<void> {
  await mkdir(downloadsDir, { recursive: true });
  // The plugins tree is bind-mounted at /plugins and read by the image's
  // unprivileged user (uid 1000), so it must be world-traversable; it holds
  // jars and config only. The sandbox dir above it keeps the 0700 record.
  await mkdir(pluginsDir, { recursive: true, mode: 0o755 });
  for (const pin of pins) {
    const jar = `${pin.name}-${pin.version}.jar`;
    await ensureArtifact(path.join(downloadsDir, jar), pin);
    await Bun.write(
      path.join(pluginsDir, jar),
      Bun.file(path.join(downloadsDir, jar)),
    );
  }
}
