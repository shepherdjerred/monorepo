import { mkdtemp, rm } from "node:fs/promises";
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
