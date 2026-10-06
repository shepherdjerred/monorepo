import { expect, test } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test("Storm docs deleting sync preserves the independently published archive", async () => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "storm-deploy-contract-"),
  );
  try {
    const aws = path.join(directory, "aws");
    await writeFile(aws, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
    await chmod(aws, 0o755);
    const child = Bun.spawn(
      [
        process.execPath,
        "scripts/release/deploy-site.ts",
        "ts-mc-docs",
        "--dry-run",
      ],
      {
        cwd: new URL("../..", import.meta.url).pathname,
        env: {
          ...Bun.env,
          PATH: `${directory}:${Bun.env["PATH"] ?? ""}`,
          // Test-only values select the command-building path. The fake AWS
          // executable reports arguments and makes no network requests.
          AWS_ACCESS_KEY_ID: "test-only",
          AWS_SECRET_ACCESS_KEY: "test-only",
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, status] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(status, stderr).toBe(0);
    expect(stdout).toContain("--exclude\nworld-archive/*\n");
    expect(stdout).toContain("--delete\n--dryrun");
    expect(stdout).toContain("s3://ts-mc-docs/");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
