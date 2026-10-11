import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  INSTALL_MANIFEST,
  ensureGameArchive,
  loadSpaghettiInstall,
  parseInstallManifest,
  sha1Hex,
  type SpaghettiInstall,
} from "./install.ts";

const ROM_BYTES = new TextEncoder().encode("not really a rom");
const COMMIT = "a".repeat(40);

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "sk-install-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * A stand-in for Torch: checks it was given the inputs and the ROM link, then
 * writes mk64.o2r into its working directory and counts its runs.
 */
async function writeFakeTorch(exitCode = 0): Promise<string> {
  const torch = path.join(dir, "install", "torch");
  const runs = path.join(dir, "torch-runs");
  await Bun.write(
    torch,
    [
      "#!/bin/sh",
      "set -e",
      `echo run >> "${runs}"`,
      '[ "$1 $2 $3 $4" = "o2r baserom.us.z64 --additional-files meta/mods.toml" ]',
      "test -f config.yml && test -d yamls && test -f include/defines.h",
      "test -f meta/mods.toml && test -f baserom.us.z64",
      exitCode === 0
        ? "printf archive > mk64.o2r"
        : `echo 'torch: bad rom' >&2; exit ${String(exitCode)}`,
    ].join("\n"),
  );
  await chmod(torch, 0o755);
  return torch;
}

async function writeInstall(): Promise<void> {
  const install = path.join(dir, "install");
  const inputs = path.join(install, "torch-inputs");
  await mkdir(path.join(inputs, "yamls/us"), { recursive: true });
  await Bun.write(path.join(inputs, "config.yml"), "x");
  await Bun.write(path.join(inputs, "yamls/us/a.yml"), "x");
  await Bun.write(path.join(inputs, "include/defines.h"), "x");
  await Bun.write(path.join(inputs, "meta/mods.toml"), "x");
  await Bun.write(path.join(install, "Spaghettify"), "x");
  await Bun.write(path.join(install, "spaghetti.o2r"), "x");
  await Bun.write(
    path.join(install, INSTALL_MANIFEST),
    JSON.stringify({
      binary: "Spaghettify",
      engineArchive: "spaghetti.o2r",
      torch: "torch",
      torchInputs: "torch-inputs",
      commit: COMMIT,
      romSha1: sha1Hex(ROM_BYTES),
    }),
  );
}

async function torchRuns(): Promise<number> {
  const file = Bun.file(path.join(dir, "torch-runs"));
  const text = (await file.exists()) ? await file.text() : "";
  return text.trim() === "" ? 0 : text.trim().split("\n").length;
}

async function setup(exitCode = 0): Promise<{
  install: SpaghettiInstall;
  rom: string;
  cache: string;
}> {
  await writeInstall();
  await writeFakeTorch(exitCode);
  const rom = path.join(dir, "rom.z64");
  await Bun.write(rom, ROM_BYTES);
  return {
    install: await loadSpaghettiInstall(path.join(dir, "install")),
    rom,
    cache: path.join(dir, "cache"),
  };
}

describe("install manifest", () => {
  it("rejects an unknown key or a malformed SHA", () => {
    const valid = {
      binary: "b",
      engineArchive: "e",
      torch: "t",
      torchInputs: "i",
      commit: COMMIT,
      romSha1: COMMIT,
    };
    expect(parseInstallManifest(valid)).toEqual(valid);
    expect(() => parseInstallManifest({ ...valid, extra: 1 })).toThrow();
    expect(() => parseInstallManifest({ ...valid, romSha1: "abc" })).toThrow();
  });

  it("resolves paths against the install directory", async () => {
    const { install } = await setup();
    expect(install.binary).toBe(path.join(dir, "install", "Spaghettify"));
    expect(install.torchInputs).toBe(path.join(dir, "install", "torch-inputs"));
  });

  it("names the missing piece of an incomplete install", async () => {
    await writeInstall();
    await expect(
      loadSpaghettiInstall(path.join(dir, "install")),
    ).rejects.toThrow(/missing its Torch extractor/);
  });

  it("explains how to build when there is no install", async () => {
    await expect(loadSpaghettiInstall(dir)).rejects.toThrow(/build:spaghetti/);
  });
});

describe("ensureGameArchive", () => {
  it("extracts once and reuses the archive for the same ROM and pin", async () => {
    const { install, rom, cache } = await setup();
    const archive = await ensureGameArchive(install, rom, cache);
    expect(archive).toBe(path.resolve(cache, "mk64.o2r"));
    expect(path.isAbsolute(archive)).toBe(true);
    expect(await Bun.file(archive).text()).toBe("archive");
    expect(await ensureGameArchive(install, rom, cache)).toBe(archive);
    expect(await torchRuns()).toBe(1);
    // The private work directory is gone.
    const entries = await readdir(cache);
    expect(entries.sort()).toEqual(["mk64.o2r", "stamp.json"]);
  });

  it("re-extracts when the pin changes", async () => {
    const { install, rom, cache } = await setup();
    await ensureGameArchive(install, rom, cache);
    await ensureGameArchive(install, rom, cache);
    await ensureGameArchive({ ...install, commit: "b".repeat(40) }, rom, cache);
    expect(await torchRuns()).toBe(2);
  });

  it("refuses a ROM other than the supported US cart", async () => {
    const { install, rom, cache } = await setup();
    await expect(
      ensureGameArchive({ ...install, romSha1: "0".repeat(40) }, rom, cache),
    ).rejects.toThrow(/not the supported Mario Kart 64/);
    expect(await torchRuns()).toBe(0);
  });

  it("fails with Torch's error and caches nothing", async () => {
    const { install, rom, cache } = await setup(3);
    await expect(ensureGameArchive(install, rom, cache)).rejects.toThrow(
      /code 3: torch: bad rom/,
    );
    expect(await readdir(cache)).toEqual([]);
  });

  it("fails clearly when the ROM is missing", async () => {
    const { install, cache } = await setup();
    await expect(
      ensureGameArchive(install, path.join(dir, "absent.z64"), cache),
    ).rejects.toThrow(/ROM not found/);
  });
});
