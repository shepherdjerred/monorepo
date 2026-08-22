import { afterAll } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const workerTempDirectory = path.join(
  tmpdir(),
  `streambot-vitest-${process.pid.toString()}`,
);

Bun.env["TMPDIR"] = workerTempDirectory;
await mkdir(workerTempDirectory, { recursive: true });

afterAll(async () => {
  await rm(workerTempDirectory, { recursive: true, force: true });
});
