// Pure helpers for the SpaghettiKart (native MK64 port) build: upstream
// manifest parsing, platform paths, ROM resolution, and ROM identity.
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

const SpaghettiUpstreamSchema = z.object({
  repository: z.url(),
  branch: z.string().min(1),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  submodules: z.array(z.string().min(1)).min(1),
  romSha1: z.string().regex(/^[a-f0-9]{40}$/),
});

export type SpaghettiUpstream = z.infer<typeof SpaghettiUpstreamSchema>;

export function parseSpaghettiUpstream(value: unknown): SpaghettiUpstream {
  return SpaghettiUpstreamSchema.parse(value);
}

/** The game binary CMake produces: an app bundle on macOS, a plain ELF elsewhere. */
export function spaghettiBinaryPath(
  buildDir: string,
  platform: NodeJS.Platform,
): string {
  return platform === "darwin"
    ? path.join(buildDir, "SpaghettiKart.app/Contents/MacOS/SpaghettiKart")
    : path.join(buildDir, "Spaghettify");
}

/** CMake configure flags. macOS takes dependencies from vcpkg, as upstream CI does; Linux uses system packages. */
export function cmakeConfigureArgs(
  sourceDir: string,
  buildDir: string,
  platform: NodeJS.Platform,
): string[] {
  return [
    "cmake",
    `-H${sourceDir}`,
    `-B${buildDir}`,
    "-GNinja",
    "-DCMAKE_BUILD_TYPE=Release",
    "-DCMAKE_POLICY_VERSION_MINIMUM=3.5",
    `-DENABLE_VCPKG=${platform === "darwin" ? "ON" : "OFF"}`,
  ];
}

/**
 * The canonical ROM homes, matching the backend harness: explicit path, then
 * MK64_ROM, then the Syncthing folders.
 */
export function romCandidates(
  explicit: string | undefined,
  env: string | undefined,
  home = os.homedir(),
): string[] {
  const candidates: string[] = [];
  for (const candidate of [explicit, env]) {
    if (candidate !== undefined && candidate.length > 0)
      candidates.push(candidate);
  }
  candidates.push(
    `${home}/syncthing/Sync/roms/mariokart64.z64`,
    `${home}/Sync/Sync/roms/mariokart64.z64`,
  );
  return candidates;
}

export function sha1(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

/** SpaghettiKart's asset extractor only understands the US cart in .z64 order. */
export function assertSupportedRom(actualSha1: string, expected: string): void {
  if (actualSha1 !== expected) {
    throw new Error(
      `ROM is not the supported Mario Kart 64 (US, .z64 byte order) image: ` +
        `SHA-1 ${actualSha1}, expected ${expected}`,
    );
  }
}
