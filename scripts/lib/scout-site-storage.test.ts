import { expect, test } from "bun:test";

import {
  immutablePutCommand,
  isMissingS3ObjectError,
  isS3PreconditionFailure,
} from "./scout-site-storage.ts";
import {
  archiveRecord,
  assertArchiveRecordMatchesState,
  inputRecordMatchesState,
  parseScoutReleaseState,
  retagScoutReleaseState,
} from "./scout-release-state.ts";

const DIGEST =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function releaseState() {
  return parseScoutReleaseState(
    JSON.stringify({
      schema: "scout-release-state/v1",
      buildNumber: 42,
      version: "2.0.0-42",
      sourceCommit: "0123456789012345678901234567890123456789",
      backendImageDigest: DIGEST,
      siteArchiveDigest: DIGEST,
      betaSiteArchiveDigest: DIGEST,
      releaseInputDigest: DIGEST,
    }),
  );
}

test("S3 lookup recognizes only confirmed missing-object diagnostics", () => {
  expect(isMissingS3ObjectError("An error occurred (NoSuchKey)")).toBe(true);
  expect(
    isMissingS3ObjectError(
      "fatal error: An error occurred (404): Key does not exist",
    ),
  ).toBe(true);
  expect(
    isMissingS3ObjectError(
      "download failed: s3://scout-site-releases/inputs/example.json to - An error occurred (404) when calling the HeadObject operation: Not Found",
    ),
  ).toBe(true);
  expect(isMissingS3ObjectError("500 Internal Server Error")).toBe(false);
  expect(isMissingS3ObjectError("403 Forbidden")).toBe(false);
  expect(isMissingS3ObjectError("404 upstream gateway")).toBe(false);
});

test("immutable record writes use an atomic create-if-absent precondition", () => {
  const command = immutablePutCommand("inputs/example.json", "/tmp/state.json");
  expect(command).toContain("--if-none-match");
  expect(command[command.indexOf("--if-none-match") + 1]).toBe("*");
  expect(command).toContain("inputs/example.json");
  expect(isS3PreconditionFailure("PreconditionFailed")).toBe(true);
  expect(isS3PreconditionFailure("status 412")).toBe(true);
  expect(isS3PreconditionFailure("status 500")).toBe(false);
});

test("archive records identify content independently of promotion version", () => {
  const historical = releaseState();
  const alias = retagScoutReleaseState(historical, 100);
  expect(archiveRecord(alias, "prod")).toBe(archiveRecord(historical, "prod"));
  expect(() =>
    assertArchiveRecordMatchesState(
      `${JSON.stringify({ ...historical, flavor: "prod" }, null, 2)}\n`,
      alias,
      "prod",
    ),
  ).not.toThrow();
  expect(() =>
    assertArchiveRecordMatchesState(
      archiveRecord(historical, "prod"),
      alias,
      "beta",
    ),
  ).toThrow("does not match");
  const changed = parseScoutReleaseState(
    JSON.stringify({
      ...alias,
      siteArchiveDigest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }),
  );
  expect(() =>
    assertArchiveRecordMatchesState(
      archiveRecord(historical, "prod"),
      changed,
      "prod",
    ),
  ).toThrow("does not match");
});

test("input indexes accept version aliases but reject changed content", () => {
  const historical = releaseState();
  const alias = retagScoutReleaseState(historical, 100);
  expect(inputRecordMatchesState(JSON.stringify(historical), alias)).toBe(true);
  const changed = parseScoutReleaseState(
    JSON.stringify({
      ...alias,
      backendImageDigest:
        "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    }),
  );
  expect(inputRecordMatchesState(JSON.stringify(historical), changed)).toBe(
    false,
  );
});

test("beta deployment checks served entrypoints before an exact-marker no-op", async () => {
  const source = await Bun.file(
    new URL("scout-site-storage.ts", import.meta.url),
  ).text();
  const betaStart = source.indexOf("export async function deployScoutBeta");
  const prodStart = source.indexOf("export async function reconcileScoutProd");
  const beta = source.slice(betaStart, prodStart);
  const mismatch = beta.indexOf("await firstS3ObjectMismatch");
  const exactMarkerNoOp = beta.indexOf(
    "currentMarker?.trim() === desired && mismatch === undefined",
  );
  expect(mismatch).toBeGreaterThan(0);
  expect(exactMarkerNoOp).toBeGreaterThan(mismatch);
  expect(beta).toContain("forceMutableUpload: true");
  expect(beta.indexOf("await assertS3ObjectsMatchSource")).toBeGreaterThan(0);
  expect(beta.indexOf("await writeMarker")).toBeGreaterThan(
    beta.indexOf("await assertS3ObjectsMatchSource"),
  );
});

test("archive bytes are remotely verified before a manifest certifies them", async () => {
  const source = await Bun.file(
    new URL("scout-site-storage.ts", import.meta.url),
  ).text();
  const archiveStart = source.indexOf("async function archiveFlavor");
  const archiveEnd = source.indexOf("export async function archiveScout");
  const archive = source.slice(archiveStart, archiveEnd);
  expect(
    archive.indexOf("await downloadAndVerifyArchiveBytes"),
  ).toBeGreaterThan(archive.indexOf('"aws",\n      "s3",\n      "sync"'));
  expect(archive.indexOf("await putImmutableObject")).toBeGreaterThan(
    archive.indexOf("await downloadAndVerifyArchiveBytes"),
  );
});

test("both live buckets verify their release marker after writing it", async () => {
  const source = await Bun.file(
    new URL("scout-site-storage.ts", import.meta.url),
  ).text();
  const beta = source.slice(
    source.indexOf("export async function deployScoutBeta"),
    source.indexOf("export async function reconcileScoutProd"),
  );
  const prod = source.slice(
    source.indexOf("export async function reconcileScoutProd"),
  );
  for (const implementation of [beta, prod]) {
    const markerWrite = implementation.indexOf("await writeMarker");
    expect(markerWrite).toBeGreaterThan(0);
    expect(
      implementation.indexOf("await readOptionalBucketObject", markerWrite),
    ).toBeGreaterThan(markerWrite);
  }
});
