import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("drains fake provider/storage on actual SIGTERM before telemetry closes, without external inference", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "promotion-shutdown-fixture-"),
  );
  const child = Bun.spawn(
    [
      process.execPath,
      fileURLToPath(
        new URL("fixtures/worker-shutdown-process.ts", import.meta.url),
      ),
      directory,
    ],
    {
      cwd: directory,
      env: { PATH: "/usr/bin:/bin" },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  try {
    const reader = child.stdout.getReader();
    const ready = await reader.read();
    expect(new TextDecoder().decode(ready.value)).toContain("READY");
    reader.releaseLock();
    child.kill("SIGTERM");
    expect(await child.exited, await new Response(child.stderr).text()).toBe(0);
    const events: unknown = await Bun.file(
      path.join(directory, "events.json"),
    ).json();
    expect(events).toEqual([
      "polling stopped",
      "ingress closed",
      "usage persisted",
      "activity cleanup",
      "resources closed",
      "tracing flushed",
      "callgraph flushed",
    ]);
    expect(await Bun.file(path.join(directory, "usage.json")).json()).toEqual({
      inputTokens: 3,
      outputTokens: 1,
      fakeProvider: true,
    });
  } finally {
    if (child.exitCode === null) {
      child.kill("SIGKILL");
      await child.exited;
    }
    await rm(directory, { recursive: true });
  }
}, 10_000);
