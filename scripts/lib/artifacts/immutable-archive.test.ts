import { expect, test } from "vitest";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { immutableArchiveKey } from "./immutable-archive.ts";

const endpointError =
  'fatal error: Could not connect to the endpoint URL: "https://seaweedfs-s3.tailnet-1a49.ts.net/delivery-artifacts/example"';

test.each([
  {
    name: "lost upload response with matching bytes",
    uploadExit: 75,
    remoteBytes: "reviewed bytes",
    readbackFailures: 0,
    readbackError: "",
    expectedDelays: [],
  },
  {
    name: "lost upload response with mismatched bytes",
    uploadExit: 75,
    remoteBytes: "different bytes",
    readbackFailures: 0,
    readbackError: "",
    expectedDelays: [],
    failure: "Published archive failed immutable byte readback",
  },
  {
    name: "create-only conflict followed by a transient endpoint outage",
    uploadExit: 254,
    remoteBytes: "reviewed bytes",
    readbackFailures: 2,
    readbackError: endpointError,
    expectedDelays: [1000, 2000],
  },
  {
    name: "create-only conflict followed by an S3 internal error",
    uploadExit: 254,
    remoteBytes: "reviewed bytes",
    readbackFailures: 1,
    readbackError:
      "download failed: s3://delivery-artifacts/example to /tmp/readback.tar AWS_ERROR_S3_INTERNAL_ERROR: ",
    expectedDelays: [1000],
  },
  {
    name: "recovered endpoint with mismatched bytes",
    uploadExit: 254,
    remoteBytes: "different bytes",
    readbackFailures: 1,
    readbackError: endpointError,
    expectedDelays: [1000],
    failure: "Published archive failed immutable byte readback",
  },
  {
    name: "persistent endpoint outage",
    uploadExit: 254,
    remoteBytes: "reviewed bytes",
    readbackFailures: 5,
    readbackError: endpointError,
    expectedDelays: [1000, 2000, 4000, 8000],
    failure: "publication is unconfirmed (upload exit 254, readback exit 1)",
  },
  {
    name: "permanent authorization failure",
    uploadExit: 254,
    remoteBytes: "reviewed bytes",
    readbackFailures: 1,
    readbackError:
      "fatal error: An error occurred (403) when calling HeadObject",
    expectedDelays: [],
    failure: "publication is unconfirmed (upload exit 254, readback exit 1)",
  },
])("requires exact immutable readback after $name", async (fixture) => {
  const root = await mkdtemp(path.join(tmpdir(), "immutable-archive-test-"));
  try {
    const source = path.join(root, "source.json");
    const remote = path.join(root, "remote.json");
    const log = path.join(root, "calls.log");
    await Bun.write(source, "reviewed bytes");
    await Bun.write(remote, fixture.remoteBytes);
    const aws = path.join(root, "aws");
    await Bun.write(
      aws,
      `#!/bin/sh
set -eu
test -z "\${OP_SERVICE_ACCOUNT_TOKEN:-}"
test -z "\${AWS_SESSION_TOKEN:-}"
test "$AWS_DEFAULT_REGION" = "us-east-1"
test "$AWS_REQUEST_CHECKSUM_CALCULATION" = "WHEN_REQUIRED"
test "$AWS_RESPONSE_CHECKSUM_VALIDATION" = "WHEN_REQUIRED"
printf '%s\\n' "$@" >> "$FIXTURE_LOG"
if [ "$1" = "s3api" ]; then exit "$FIXTURE_UPLOAD_EXIT"; fi
if [ "$(grep -cx s3 "$FIXTURE_LOG")" -le "$FIXTURE_READBACK_FAILURES" ]; then
  printf '%s\\n' "$FIXTURE_READBACK_ERROR" >&2
  exit 1
fi
cp "$FIXTURE_REMOTE" "$4"
`,
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
        `import {publishImmutableArchive} from ${JSON.stringify(new URL("immutable-archive.ts", import.meta.url).pathname)};
          Bun.sleep = async (ms) => console.error("retry-delay-ms=" + ms);
          await publishImmutableArchive(${JSON.stringify(input)});`,
      ],
      {
        env: {
          ...Bun.env,
          PATH: `${root}:${Bun.env["PATH"] ?? ""}`,
          FIXTURE_LOG: log,
          FIXTURE_REMOTE: remote,
          FIXTURE_UPLOAD_EXIT: String(fixture.uploadExit),
          FIXTURE_READBACK_FAILURES: String(fixture.readbackFailures),
          FIXTURE_READBACK_ERROR: fixture.readbackError,
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
    expect(status === 0, stderr).toBe(fixture.failure === undefined);
    if (fixture.failure !== undefined)
      expect(stderr).toContain(fixture.failure);
    const callLog = await Bun.file(log).text();
    const calls = callLog.split("\n");
    expect(calls.filter((call) => call === "put-object")).toHaveLength(1);
    expect(calls[calls.indexOf("--if-none-match") + 1]).toBe("*");
    expect(calls.filter((call) => call === "cp")).toHaveLength(
      fixture.expectedDelays.length + 1,
    );
    expect(stderr.match(/retry-delay-ms=\d+/gu) ?? []).toEqual(
      fixture.expectedDelays.map((ms) => `retry-delay-ms=${String(ms)}`),
    );
  } finally {
    await rm(root, { recursive: true });
  }
});

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
