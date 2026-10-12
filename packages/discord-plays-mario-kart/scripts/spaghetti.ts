// Helpers for the SpaghettiKart (native MK64 port) build: upstream manifest
// parsing, platform paths, patch application, and the install manifest.
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

/** The OFL font the port ships, drawn into the stream's name labels. */
export const LABEL_FONT = "assets/fonts/Montserrat-Regular.ttf";

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
  labelFont: string;
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
    labelFont: path.join(sourceDir, LABEL_FONT),
    commit: upstream.commit,
    romSha1: upstream.romSha1,
  };
}

/** Apply one patch from the series with patch(1), in the checkout `cwd`. */
export async function applyPatch(patch: string, cwd: string): Promise<void> {
  const child = Bun.spawn(
    ["patch", "-p1", "--forward", "--no-backup-if-mismatch"],
    {
      cwd,
      stdin: Bun.file(patch),
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  if ((await child.exited) !== 0) throw new Error(`Patch failed: ${patch}`);
}
