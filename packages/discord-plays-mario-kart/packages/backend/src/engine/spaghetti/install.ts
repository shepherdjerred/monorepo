// The SpaghettiKart install (build output) and its ROM-derived asset archive.
//
// An install directory holds what `bun run build:spaghetti` or the image's
// spaghetti-builder stage produced, described by install.json: the game
// binary, spaghetti.o2r (built from source), Torch, the inputs Torch reads to
// extract mk64.o2r from the ROM, and the font the name labels are drawn in.
//
// mk64.o2r is extracted from the ROM, so it follows the ROM's rules: it is
// generated at runtime into a private cache, never committed, logged, or baked
// into an image.
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  rename,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { logger } from "#src/logger.ts";

const InstallManifestSchema = z.strictObject({
  /** Paths are relative to the install directory, or absolute. */
  binary: z.string().min(1),
  engineArchive: z.string().min(1),
  torch: z.string().min(1),
  /** Holds config.yml, yamls/, include/defines.h and meta/mods.toml. */
  torchInputs: z.string().min(1),
  /** A TrueType font the port ships (OFL), for the stream's name labels. */
  labelFont: z.string().min(1),
  /** The upstream commit the install was built from. */
  commit: z.string().regex(/^[a-f0-9]{40}$/),
  /** The only ROM the pinned extractor supports (US, .z64 byte order). */
  romSha1: z.string().regex(/^[a-f0-9]{40}$/),
});
export type InstallManifest = z.infer<typeof InstallManifestSchema>;

export const INSTALL_MANIFEST = "install.json";

export type SpaghettiInstall = {
  readonly binary: string;
  readonly engineArchive: string;
  readonly torch: string;
  readonly torchInputs: string;
  readonly labelFont: string;
  readonly commit: string;
  readonly romSha1: string;
};

/** What a session needs: the game process's files, plus the label font. */
export type SpaghettiBuild = {
  readonly binary: string;
  readonly engineArchive: string;
  readonly gameArchive: string;
  readonly labelFont: string;
};

const TORCH_INPUTS = [
  "config.yml",
  "yamls",
  "include/defines.h",
  "meta/mods.toml",
] as const;

export function parseInstallManifest(value: unknown): InstallManifest {
  return InstallManifestSchema.parse(value);
}

async function requireExists(file: string, what: string): Promise<void> {
  try {
    await stat(file);
  } catch (error) {
    throw new Error(`SpaghettiKart install is missing its ${what}: ${file}`, {
      cause: error,
    });
  }
}

/** Load and check an install directory. Missing pieces fail loudly. */
export async function loadSpaghettiInstall(
  installDir: string,
): Promise<SpaghettiInstall> {
  const manifestPath = path.join(installDir, INSTALL_MANIFEST);
  const file = Bun.file(manifestPath);
  if (!(await file.exists())) {
    throw new Error(
      `SpaghettiKart is not installed: ${manifestPath} is missing. Build it ` +
        "with `bun run --cwd packages/discord-plays-mario-kart build:spaghetti`.",
    );
  }
  const manifest = parseInstallManifest(await file.json());
  const resolve = (p: string): string => path.resolve(installDir, p);
  const install: SpaghettiInstall = {
    binary: resolve(manifest.binary),
    engineArchive: resolve(manifest.engineArchive),
    torch: resolve(manifest.torch),
    torchInputs: resolve(manifest.torchInputs),
    labelFont: resolve(manifest.labelFont),
    commit: manifest.commit,
    romSha1: manifest.romSha1,
  };
  await requireExists(install.binary, "game binary");
  await requireExists(install.engineArchive, "engine archive");
  await requireExists(install.torch, "Torch extractor");
  await requireExists(install.labelFont, "label font");
  for (const input of TORCH_INPUTS) {
    await requireExists(
      path.join(install.torchInputs, input),
      `Torch input ${input}`,
    );
  }
  return install;
}

export function sha1Hex(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex");
}

/** The pinned extractor only understands the US cart in .z64 byte order. */
export function assertSupportedRom(actualSha1: string, expected: string): void {
  if (actualSha1 !== expected) {
    throw new Error(
      "ROM is not the supported Mario Kart 64 (US, .z64 byte order) image: " +
        `SHA-1 ${actualSha1}, expected ${expected}`,
    );
  }
}

/** Identifies an extraction: a new ROM or a new pin re-extracts. */
export function archiveStamp(install: SpaghettiInstall): string {
  return JSON.stringify({ romSha1: install.romSha1, commit: install.commit });
}

/**
 * Extract mk64.o2r from the ROM into `cacheDir`, unless this ROM and pin
 * already produced it there. Returns the archive path.
 */
export async function ensureGameArchive(
  install: SpaghettiInstall,
  romPath: string,
  cacheDir: string,
): Promise<string> {
  const rom = Bun.file(romPath);
  if (!(await rom.exists())) {
    throw new Error(`MK64 ROM not found at ${romPath}`);
  }
  assertSupportedRom(sha1Hex(await rom.bytes()), install.romSha1);

  // Absolute: the game's home links to it from a different directory.
  const output = path.resolve(cacheDir, "mk64.o2r");
  const stamp = path.join(cacheDir, "stamp.json");
  const wanted = archiveStamp(install);
  if (
    (await Bun.file(output).exists()) &&
    (await Bun.file(stamp).exists()) &&
    (await Bun.file(stamp).text()) === wanted
  ) {
    return output;
  }

  logger.info("extracting the SpaghettiKart game archive from the ROM", {
    commit: install.commit.slice(0, 10),
  });
  const startedAt = performance.now();
  await mkdir(cacheDir, { recursive: true });
  // Torch reads its inputs relative to its working directory and writes
  // mk64.o2r there; give it a private one beside the cache so the final
  // rename stays on one filesystem.
  const work = await mkdtemp(path.join(cacheDir, "extract-"));
  try {
    for (const input of TORCH_INPUTS) {
      await cp(path.join(install.torchInputs, input), path.join(work, input), {
        recursive: true,
      });
    }
    await symlink(path.resolve(romPath), path.join(work, "baserom.us.z64"));
    const torch = Bun.spawn(
      [
        install.torch,
        "o2r",
        "baserom.us.z64",
        "--additional-files",
        "meta/mods.toml",
      ],
      { cwd: work, stdout: "ignore", stderr: "pipe" },
    );
    const [stderr, code] = await Promise.all([
      new Response(torch.stderr).text(),
      torch.exited,
    ]);
    if (code !== 0) {
      throw new Error(
        `Torch exited with code ${String(code)}: ${stderr.trim().slice(-2000)}`,
      );
    }
    await rename(path.join(work, "mk64.o2r"), output);
    await Bun.write(stamp, wanted);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  logger.info("extracted the SpaghettiKart game archive", {
    seconds: Math.round((performance.now() - startedAt) / 100) / 10,
  });
  return output;
}

/** Load the install and make sure its game archive exists for this ROM. */
export async function prepareSpaghettiBuild(params: {
  installDir: string;
  romPath: string;
  cacheDir: string;
}): Promise<SpaghettiBuild> {
  const install = await loadSpaghettiInstall(params.installDir);
  const gameArchive = await ensureGameArchive(
    install,
    params.romPath,
    params.cacheDir,
  );
  return {
    binary: install.binary,
    engineArchive: install.engineArchive,
    gameArchive,
    labelFont: install.labelFont,
  };
}
