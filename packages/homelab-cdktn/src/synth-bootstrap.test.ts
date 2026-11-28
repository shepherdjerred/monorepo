import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import { ensureGeneratedBindings, GENERATE_COMMAND } from "#scripts/synth.ts";

describe("synth bootstrap bindings check", () => {
  test("skips generation when generated/providers already contains bindings", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "synth-bootstrap-"));
    try {
      const providersDirectory = path.join(scratch, "generated/providers/aws");
      await mkdir(providersDirectory, { recursive: true });
      const runGenerate = vi.fn(() => Promise.resolve());

      await ensureGeneratedBindings({
        providersDirectory: path.join(scratch, "generated/providers"),
        autoGenerate: true,
        runGenerate,
      });

      expect(runGenerate).not.toHaveBeenCalled();
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  test("names the turbo generate prerequisite when bindings are missing and autoGenerate is off", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "synth-bootstrap-"));
    try {
      await expect(
        ensureGeneratedBindings({
          providersDirectory: path.join(scratch, "generated/providers"),
        }),
      ).rejects.toThrow(GENERATE_COMMAND);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  test("triggers generation on a fresh tree when autoGenerate is enabled", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "synth-bootstrap-"));
    try {
      const providersDirectory = path.join(scratch, "generated/providers");
      const runGenerate = vi.fn(async () => {
        await mkdir(path.join(providersDirectory, "aws"), { recursive: true });
        await writeFile(
          path.join(providersDirectory, "aws/index.ts"),
          "export const generated = true;\n",
        );
      });

      await ensureGeneratedBindings({
        providersDirectory,
        autoGenerate: true,
        runGenerate,
      });

      expect(runGenerate).toHaveBeenCalledTimes(1);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });

  test("reports the turbo generate prerequisite when automatic generation fails or produces nothing", async () => {
    const scratch = await mkdtemp(path.join(tmpdir(), "synth-bootstrap-"));
    try {
      const providersDirectory = path.join(scratch, "generated/providers");
      await expect(
        ensureGeneratedBindings({
          providersDirectory,
          autoGenerate: true,
          runGenerate: () => Promise.reject(new Error("spawn failed")),
        }),
      ).rejects.toThrow(GENERATE_COMMAND);

      await expect(
        ensureGeneratedBindings({
          providersDirectory,
          autoGenerate: true,
          runGenerate: () => Promise.resolve(),
        }),
      ).rejects.toThrow(GENERATE_COMMAND);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  });
});
