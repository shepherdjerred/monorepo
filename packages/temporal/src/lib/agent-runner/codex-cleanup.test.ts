import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test, vi } from "vitest";
import { cleanupCodexRun } from "./codex-cleanup.ts";

test("filesystem cleanup failures still finish the parser and trace", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "codex-cleanup-test-"),
  );
  const finishParser = vi.fn();
  const endTrace = vi.fn();
  try {
    const failure = await cleanupCodexRun({
      workdir: directory,
      subscriptionAuthPath: directory,
      providerWrapperDirectory: undefined,
      parser: { finish: finishParser },
      trace: { end: endTrace },
      traceOutcome: "success",
    });
    expect(failure?.cause).toBeInstanceOf(Error);
    expect(finishParser).toHaveBeenCalledOnce();
    expect(endTrace).toHaveBeenCalledWith("error");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("restores the subscription staging parent's original mode", async () => {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "codex-parent-mode-test-"),
  );
  try {
    await chmod(directory, 0o711);
    const failure = await cleanupCodexRun({
      workdir: directory,
      subscriptionAuthPath: undefined,
      subscriptionParentMode: {
        directories: [{ directory, mode: 0o600 }],
      },
      providerWrapperDirectory: undefined,
      parser: { finish: vi.fn() },
      trace: { end: vi.fn() },
      traceOutcome: "success",
    });
    expect(failure).toBeUndefined();
    const restored = await stat(directory);
    expect(restored.mode & 0o777).toBe(0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
