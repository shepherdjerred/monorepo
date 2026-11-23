import { mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  parseReplayComparisonArguments,
  runReplayComparisonPublication,
} from "./publish-replay-comparison.ts";
import type { verifyPublishedReplayPackage } from "./replay-publication/admission-input.ts";
import type { publishReplayObject } from "./replay-publication/storage.ts";

vi.mock("#src/database/index.ts", () => {
  throw new Error("Comparison publication must never load the database");
});

const gameBuild = "16.23.840.6595";
const protocol = "a".repeat(16);
const manifestSha256 = "b".repeat(64);
const rosterInventorySha256 = "c".repeat(64);
const referenceCaptureSha256 = "d".repeat(64);
const result = "perceptual-equivalence";
const coverage = "whole-match-visual-audio-and-spectator-controls";
const comparison = {
  schemaVersion: 1,
  gameBuild,
  protocol,
  manifestSha256,
  rosterInventorySha256,
  referenceCaptureSha256,
  result,
  coverage,
} as const;
const scratch = new Map<string, string>();
const originalReport = `${JSON.stringify(comparison, null, 2)}\r\n`;

afterEach(async () => {
  for (const [directory, root] of scratch) {
    if (path.dirname(await realpath(directory)) !== root)
      throw new Error("Comparison publication test scratch escaped its root");
    await rm(directory, { recursive: true, force: true });
    scratch.delete(directory);
  }
});

async function fixture(
  options: {
    original?: string;
    reviewedSha256?: string;
    reviewedPath?: string;
  } = {},
) {
  const root = await realpath(tmpdir());
  const directory = await mkdtemp(
    path.join(root, "scout-comparison-cli-test-"),
  );
  scratch.set(directory, root);
  const original = options.original ?? originalReport;
  const reportSha256 =
    options.reviewedSha256 ??
    new Bun.CryptoHasher("sha256").update(original).digest("hex");
  const reportPath =
    options.reviewedPath ?? `/replay-evidence/${reportSha256}/report.json`;
  const publication = { fixture: "publication" };
  const admission = {
    schemaVersion: 1,
    manifestSha256,
    rosterInventorySha256,
    nativeComparison: {
      gameBuild,
      reportPath,
      reportSha256,
      referenceCaptureSha256,
      result,
      coverage,
    },
  } as const;
  const publicationFile = path.join(directory, "publication.json");
  const admissionFile = path.join(directory, "admission.json");
  const reportFile = path.join(directory, "report.json");
  await Bun.write(publicationFile, JSON.stringify(publication));
  await Bun.write(admissionFile, JSON.stringify(admission));
  await Bun.write(reportFile, original);
  const client = createS3Client();
  const destroy = vi.spyOn(client, "destroy");
  const verified = {
    gameBuild,
    protocol,
    manifestSha256,
    manifestPath: `/replay-assets/${gameBuild}/${manifestSha256}/manifest.json`,
    manifestJson: "{}",
    admissionJson: admission,
  };
  const deps = {
    createClient: vi.fn(() => client),
    verify: vi
      .fn<typeof verifyPublishedReplayPackage>()
      .mockResolvedValue(verified),
    publish: vi.fn<typeof publishReplayObject>().mockResolvedValue(undefined),
  };
  const args = [
    `--publication=${publicationFile}`,
    `--admission=${admissionFile}`,
    `--report=${reportFile}`,
    "--stage=beta",
  ];
  return {
    original,
    reportSha256,
    reportPath,
    reportFile,
    client,
    destroy,
    deps,
    args,
    publication,
    admission,
    verified,
  };
}

test("default verifies the exact target and reviewed report without opening a writer", async () => {
  const { args, deps, publication, admission, reportPath, reportSha256 } =
    await fixture();
  const options = parseReplayComparisonArguments(args);
  await expect(runReplayComparisonPublication(options, deps)).resolves.toEqual({
    outcome: "verified",
    stage: "beta",
    bucket: "scout-frontend-beta",
    origin: "https://beta.scout-for-lol.com",
    gameBuild,
    protocol,
    manifestSha256,
    reportUrl: `https://beta.scout-for-lol.com${reportPath}`,
    reportSha256,
    reportBytes: Buffer.byteLength(originalReport),
  });
  expect(deps.verify).toHaveBeenCalledExactlyOnceWith({
    stage: "beta",
    bucket: "scout-frontend-beta",
    origin: new URL("https://beta.scout-for-lol.com"),
    publication,
    admission,
  });
  expect(deps.createClient).not.toHaveBeenCalled();
  expect(deps.publish).not.toHaveBeenCalled();
});

test("apply publishes the exact verified bytes from owned scratch and closes the writer", async () => {
  const {
    args,
    deps,
    client,
    destroy,
    original,
    reportFile,
    reportPath,
    reportSha256,
    verified,
  } = await fixture();
  deps.verify.mockImplementationOnce(async () => {
    await Bun.write(reportFile, "{}");
    return verified;
  });
  deps.publish.mockImplementationOnce(async ({ object }) => {
    expect(object.path).not.toBe(reportFile);
    expect(await Bun.file(object.path).text()).toBe(original);
  });
  const options = parseReplayComparisonArguments([...args, "--apply"]);
  await expect(
    runReplayComparisonPublication(options, deps),
  ).resolves.toMatchObject({ outcome: "published" });
  expect(deps.verify).toHaveBeenCalledBefore(deps.createClient);
  const published = deps.publish.mock.calls[0]?.[0];
  if (published === undefined) throw new Error("No comparison was published");
  expect(published).toMatchObject({
    client,
    bucket: "scout-frontend-beta",
    origin: new URL("https://beta.scout-for-lol.com"),
    object: {
      key: reportPath.slice(1),
      bytes: Buffer.byteLength(original),
      sha256: reportSha256,
      contentType: "application/json",
    },
  });
  await expect(stat(path.dirname(published.object.path))).rejects.toMatchObject(
    { code: "ENOENT" },
  );
  expect(destroy).toHaveBeenCalledOnce();
});

test.each([
  {
    reviewedSha256: "0".repeat(64),
    error: "does not match the reviewed SHA-256",
  },
  {
    reviewedPath: "/other/report.json",
    error: "canonical same-origin report path",
  },
])(
  "rejects a mismatched report digest or path before any remote work",
  async ({ error, ...input }) => {
    const { args, deps } = await fixture(input);
    const options = parseReplayComparisonArguments([...args, "--apply"]);
    await expect(runReplayComparisonPublication(options, deps)).rejects.toThrow(
      error,
    );
    expect(deps.verify).not.toHaveBeenCalled();
    expect(deps.createClient).not.toHaveBeenCalled();
    expect(deps.publish).not.toHaveBeenCalled();
  },
);

test("matching hashes do not authorize extra report fields or raw evidence", async () => {
  const { args, deps } = await fixture({
    original: JSON.stringify({
      ...comparison,
      capture: "synthetic-not-for-publication",
      playerId: 1,
    }),
  });
  const options = parseReplayComparisonArguments([...args, "--apply"]);
  await expect(runReplayComparisonPublication(options, deps)).rejects.toThrow();
  expect(deps.createClient).not.toHaveBeenCalled();
  expect(deps.publish).not.toHaveBeenCalled();
});

test("duplicate recognized fields cannot conceal raw evidence in the original bytes", async () => {
  const original = originalReport.replace(
    "{",
    '{"result":{"capture":"synthetic-not-for-publication"},',
  );
  const { args, deps } = await fixture({ original });
  const options = parseReplayComparisonArguments([...args, "--apply"]);
  await expect(runReplayComparisonPublication(options, deps)).rejects.toThrow(
    "duplicate JSON fields",
  );
  expect(deps.createClient).not.toHaveBeenCalled();
  expect(deps.publish).not.toHaveBeenCalled();
});

test("requires a local report path and rejects duplicate flags", async () => {
  const { args } = await fixture();
  expect(() =>
    parseReplayComparisonArguments(
      args.filter((argument) => !argument.startsWith("--report=")),
    ),
  ).toThrow();
  expect(() =>
    parseReplayComparisonArguments([...args, "--stage=prod"]),
  ).toThrow("--stage may appear only once");
});
