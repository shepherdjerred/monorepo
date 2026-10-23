import { expect, test } from "vitest";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { immutableArchiveKey } from "./immutable-archive.ts";

test.each([false, true])(
  "lost upload response still requires exact immutable readback (corrupt=%s)",
  async (corrupt) => {
    const root = await mkdtemp(path.join(tmpdir(), "immutable-archive-test-"));
    try {
      const source = path.join(root, "source.json");
      const remote = path.join(root, "remote.json");
      const log = path.join(root, "calls.log");
      await Bun.write(source, "reviewed bytes");
      await Bun.write(remote, corrupt ? "different bytes" : "reviewed bytes");
      const aws = path.join(root, "aws");
      await Bun.write(
        aws,
        '#!/bin/sh\nset -eu\ntest -z "${OP_SERVICE_ACCOUNT_TOKEN:-}"\ntest -z "${AWS_SESSION_TOKEN:-}"\nprintf "%s\\n" "$@" >> "$FIXTURE_LOG"\nif [ "$1" = "s3api" ]; then exit 75; fi\ncp "$FIXTURE_REMOTE" "$4"\n',
      );
      await chmod(aws, 0o755);
      const input = {
        file: source,
        readback: path.join(root, "readback.json"),
        digest: `sha256:${createHash("sha256").update("reviewed bytes").digest("hex")}`,
        uri: `s3://delivery-artifacts/trmnl-plugins/${createHash("sha256").update("reviewed bytes").digest("hex")}.json`,
      };
      const child = Bun.spawn(
        [
          process.execPath,
          "--eval",
          `import {publishImmutableArchive} from ${JSON.stringify(new URL("immutable-archive.ts", import.meta.url).pathname)}; await publishImmutableArchive(${JSON.stringify(input)});`,
        ],
        {
          env: {
            ...Bun.env,
            PATH: `${root}:${Bun.env["PATH"] ?? ""}`,
            FIXTURE_LOG: log,
            FIXTURE_REMOTE: remote,
            DELIVERY_ARCHIVE_PUBLISHER_ACCESS_KEY_ID: "test-only",
            DELIVERY_ARCHIVE_PUBLISHER_SECRET_ACCESS_KEY: "test-only",
            OP_SERVICE_ACCOUNT_TOKEN: "test-only",
            AWS_SESSION_TOKEN: "test-only",
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      const [status, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(status === 0, stderr).toBe(!corrupt);
      const calls = await Bun.file(log).text();
      expect(calls).toContain("--if-none-match\n*\n");
      expect(calls).toContain("s3\ncp\n");
      if (corrupt) expect(stderr).toContain("immutable byte readback");
    } finally {
      await rm(root, { recursive: true });
    }
  },
);

test("an archive key ends in its exact content digest, including a Git source's commit tarball", () => {
  const hex = "a".repeat(64);
  const digest = `sha256:${hex}`;
  for (const suffix of [".json", ".tar", ".tgz", ".tar.gz"])
    expect(
      immutableArchiveKey(
        `s3://delivery-artifacts/sources/adyanth/cloudflare-operator/${hex}${suffix}`,
        digest,
      ),
    ).toBe(`sources/adyanth/cloudflare-operator/${hex}${suffix}`);
  expect(() =>
    immutableArchiveKey(
      `s3://delivery-artifacts/sources/x/${"b".repeat(64)}.tar.gz`,
      digest,
    ),
  ).toThrow("exact content digest");
  expect(() =>
    immutableArchiveKey(`s3://other-bucket/sources/x/${hex}.tar.gz`, digest),
  ).toThrow("Invalid immutable archive target");
  expect(() =>
    immutableArchiveKey(`s3://delivery-artifacts/sources/x/${hex}.zip`, digest),
  ).toThrow("exact content digest");
});
