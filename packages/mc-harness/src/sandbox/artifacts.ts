/**
 * Pinned files a disposable Paper server needs, staged on the host before any
 * provider starts it: the Paper jar, third-party plugin jars, and a
 * throttle-free bukkit.yml. Provider independent; the-storm's E2E harness
 * uses the same helpers.
 */
import { createHash } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { paper, type PluginPin } from "#src/pins.ts";

/** File name the itzg image looks for before downloading Paper itself. */
export const paperJarName = `paper-${paper.version}-${paper.build.toString()}.jar`;

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

/** Downloads once into the cache and verifies the pinned sha256 on every run. */
export async function ensureArtifact(
  file: string,
  pin: Pick<PluginPin, "url" | "sha256">,
): Promise<void> {
  const cached = Bun.file(file);
  const exists = await cached.exists();
  const bytes = exists
    ? new Uint8Array(await cached.arrayBuffer())
    : await download(pin.url);
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== pin.sha256) {
    throw new Error(
      `${path.basename(file)} sha256 mismatch: expected ${pin.sha256}, got ${actual}`,
    );
  }
  if (!exists) {
    await Bun.write(file, bytes);
  }
}

/** Copies each pinned jar (downloaded once into `downloadsDir`) into `pluginsDir`. */
export async function stagePinnedPlugins(
  downloadsDir: string,
  pluginsDir: string,
  pins: readonly Pick<PluginPin, "name" | "version" | "url" | "sha256">[],
): Promise<void> {
  await mkdir(downloadsDir, { recursive: true });
  await mkdir(pluginsDir, { recursive: true, mode: 0o700 });
  for (const pin of pins) {
    const jar = `${pin.name}-${pin.version}.jar`;
    await ensureArtifact(path.join(downloadsDir, jar), pin);
    await Bun.write(
      path.join(pluginsDir, jar),
      Bun.file(path.join(downloadsDir, jar)),
    );
  }
}
