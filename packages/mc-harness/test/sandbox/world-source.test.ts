import {
  mkdtemp,
  stat,
  readFile,
  mkdir,
  writeFile,
  symlink,
  realpath,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  requireWorldDirectory,
  stageWorldDirectory,
} from "#sandbox/world-source.ts";
import { SandboxCreateRequestSchema } from "#protocol/ipc.ts";

describe("saved-world input", () => {
  it("makes only the disposable copy writable for the container user", async () => {
    const root = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "world-stage-")),
    );
    try {
      const source = path.join(root, "source");
      const destination = path.join(root, "copy");
      await mkdir(source);
      await writeFile(path.join(source, "level.dat"), "native metadata", {
        mode: 0o600,
      });
      await stageWorldDirectory(source, destination);
      const sourceInfo = await stat(path.join(source, "level.dat"));
      const copiedInfo = await stat(path.join(destination, "level.dat"));
      expect(sourceInfo.mode & 0o777).toBe(0o600);
      expect(copiedInfo.mode & 0o777).toBe(0o666);
      expect(await readFile(path.join(destination, "level.dat"), "utf8")).toBe(
        "native metadata",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
  it("accepts a native world and rejects links without changing source files", async () => {
    const directory = await realpath(
      await mkdtemp(path.join(os.tmpdir(), "world-source-")),
    );
    try {
      await writeFile(path.join(directory, "level.dat"), "native metadata");
      await mkdir(path.join(directory, "region"));
      await requireWorldDirectory(directory);
      await symlink(
        path.join(directory, "level.dat"),
        path.join(directory, "region", "linked.mca"),
      );
      await expect(requireWorldDirectory(directory)).rejects.toThrow(
        "linked or non-regular",
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects relative, cluster and published-profile source requests", () => {
    const base = {
      profile: "storm-dev",
      world: "flat",
      keep: true,
      ttlSeconds: 3600,
    };
    expect(
      SandboxCreateRequestSchema.safeParse({
        ...base,
        worldDirectory: "/private/world",
      }).success,
    ).toBe(true);
    expect(
      SandboxCreateRequestSchema.safeParse({
        ...base,
        worldDirectory: "relative",
      }).success,
    ).toBe(false);
    expect(
      SandboxCreateRequestSchema.safeParse({
        ...base,
        provider: "kubernetes",
        worldDirectory: "/private/world",
      }).success,
    ).toBe(false);
    expect(
      SandboxCreateRequestSchema.safeParse({
        ...base,
        profile: "storm-prod",
        worldDirectory: "/private/world",
      }).success,
    ).toBe(false);
  });
});
