// Pure helpers for the SpaghettiKart (native MK64 port) build: upstream
// manifest parsing, platform paths, and the install manifest.
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
 * The install.json the backend loads (engine/spaghetti/install.ts), pointing
 * into a local build. Torch's inputs are files of the source checkout itself.
 * The image's spaghetti-builder stage writes the same shape with relative paths.
 */
export type DevInstallManifest = {
  binary: string;
  engineArchive: string;
  torch: string;
  torchInputs: string;
  commit: string;
  romSha1: string;
};

export function devInstallManifest(
  upstream: SpaghettiUpstream,
  sourceDir: string,
  buildDir: string,
  platform: NodeJS.Platform,
): DevInstallManifest {
  return {
    binary: spaghettiBinaryPath(buildDir, platform),
    engineArchive: path.join(buildDir, "spaghetti.o2r"),
    torch: path.join(buildDir, "TorchExternal/src/TorchExternal-build/torch"),
    torchInputs: sourceDir,
    commit: upstream.commit,
    romSha1: upstream.romSha1,
  };
}
