import { expect, test } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

test.each([
  {
    site: "ts-mc",
    bucket: "ts-mc-docs",
    protectedPrefix: "world-archive/*",
  },
  { site: "sjer.red", bucket: "sjer-red", protectedPrefix: "_astro/*" },
])(
  "$site finishes deletion before copying release files",
  async ({ site, bucket, protectedPrefix }) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "storm-deploy-contract-"),
    );
    try {
      const aws = path.join(directory, "aws");
      await writeFile(
        aws,
        '#!/bin/sh\nprintf "AWS_CALL_BEGIN\\n"\nprintf "%s\\n" "$@"\nprintf "AWS_CALL_END\\n"\n',
      );
      await chmod(aws, 0o755);
      const child = Bun.spawn(
        [process.execPath, "scripts/release/deploy-site.ts", site, "--dry-run"],
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
      const commands = [
        ...stdout.matchAll(/AWS_CALL_BEGIN\n([\s\S]*?)AWS_CALL_END/gu),
      ].map((match) => match[1]?.trim().split("\n") ?? []);
      expect(commands.length).toBeGreaterThanOrEqual(2);
      const [prune, overwrite] = commands;
      expect(prune?.slice(0, 2)).toEqual(["s3", "sync"]);
      expect(prune).toContain("--delete");
      expect(overwrite?.slice(0, 2)).toEqual(["s3", "cp"]);
      expect(overwrite).toContain("--recursive");
      for (const command of [prune, overwrite]) {
        expect(command).toContain(`s3://${bucket}/`);
        expect(command).toContain(protectedPrefix);
        expect(command).toContain("--dryrun");
      }
      // An out-of-order listing must never delete files after the repair copy.
      for (const command of commands.slice(1)) {
        expect(command).not.toContain("--delete");
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
