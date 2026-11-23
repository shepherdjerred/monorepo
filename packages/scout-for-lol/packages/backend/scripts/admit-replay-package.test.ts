import { mkdir, mkdtemp, realpath, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
  parseReplayAdmissionArguments,
  runReplayAdmission,
} from "./admit-replay-package.ts";
import type { verifyReplayAdmissionInputs } from "./replay-publication/admission-input.ts";
import type { admitVerifiedReplayPackage } from "./replay-publication/registry.ts";

vi.mock("#src/database/index.ts", () => {
  throw new Error("Admission CLI tests must never load a database client");
});

const gameBuild = "16.23.840.6595";
const protocol = "a".repeat(16);
const manifestSha256 = "b".repeat(64);
const manifestPath = `/replay-assets/${gameBuild}/${manifestSha256}/manifest.json`;
const reportSha256 = "c".repeat(64);
const publication = { fixture: "publication" };
const admission = { fixture: "reviewed input" };
const verified = {
  gameBuild,
  protocol,
  manifestSha256,
  manifestPath,
  manifestJson: '{"fixture":true}',
  admissionJson: {
    schemaVersion: 1,
    manifestSha256,
    rosterInventorySha256: "d".repeat(64),
    nativeComparison: {
      gameBuild,
      reportSha256,
      reportPath: `/replay-evidence/${reportSha256}/report.json`,
      referenceCaptureSha256: "e".repeat(64),
      result: "perceptual-equivalence",
      coverage: "whole-match-visual-audio-and-spectator-controls",
    },
  },
} satisfies Awaited<ReturnType<typeof verifyReplayAdmissionInputs>>;

let scratchRoot: string;
let directory: string;

beforeAll(async () => {
  scratchRoot = await realpath(tmpdir());
  directory = await mkdtemp(
    path.join(scratchRoot, "scout-admission-cli-test-"),
  );
  await Bun.write(
    path.join(directory, "publication.json"),
    JSON.stringify(publication),
  );
  await Bun.write(
    path.join(directory, "admission.json"),
    JSON.stringify(admission),
  );
});

afterAll(async () => {
  if (path.dirname(await realpath(directory)) !== scratchRoot)
    throw new Error("Replay admission test scratch escaped its root");
  await rm(directory, { recursive: true, force: true });
});

function args(
  stage = "beta",
  publicationFile = "publication.json",
  admissionFile = "admission.json",
) {
  return [
    `--publication=${path.join(directory, publicationFile)}`,
    `--admission=${path.join(directory, admissionFile)}`,
    `--stage=${stage}`,
    "--platform=NA1",
  ];
}

function dependencies() {
  return {
    verify: vi
      .fn<typeof verifyReplayAdmissionInputs>()
      .mockResolvedValue(verified),
    admit: vi
      .fn<typeof admitVerifiedReplayPackage>()
      .mockResolvedValue("admitted"),
  };
}

test("default verifies public beta bytes against both inputs without registry work", async () => {
  const deps = dependencies();
  const options = parseReplayAdmissionArguments(args());
  expect(await runReplayAdmission(options, deps)).toEqual({
    outcome: "verified",
    stage: "beta",
    platformId: "NA1",
    bucket: "scout-frontend-beta",
    origin: "https://beta.scout-for-lol.com",
    gameBuild,
    protocol,
    manifestSha256,
    manifestUrl: `https://beta.scout-for-lol.com${manifestPath}`,
  });
  expect(deps.verify).toHaveBeenCalledExactlyOnceWith({
    publication,
    admission,
    stage: "beta",
    bucket: "scout-frontend-beta",
    origin: new URL("https://beta.scout-for-lol.com"),
  });
  expect(deps.admit).not.toHaveBeenCalled();
});

test.each(["admitted", "already_admitted"] as const)(
  "apply verifies production bytes first and preserves the %s outcome",
  async (outcome) => {
    const deps = dependencies();
    deps.admit.mockResolvedValueOnce(outcome);
    const options = parseReplayAdmissionArguments([...args("prod"), "--apply"]);
    await expect(runReplayAdmission(options, deps)).resolves.toMatchObject({
      outcome,
      stage: "prod",
      bucket: "scout-frontend",
    });
    expect(deps.verify).toHaveBeenCalledExactlyOnceWith({
      publication,
      admission,
      stage: "prod",
      bucket: "scout-frontend",
      origin: new URL("https://scout-for-lol.com"),
    });
    expect(deps.verify).toHaveBeenCalledBefore(deps.admit);
    expect(deps.admit).toHaveBeenCalledExactlyOnceWith({
      stage: "prod",
      platformId: "NA1",
      verified,
    });
  },
);

test("failed public verification prevents registry mutation even with apply", async () => {
  const deps = dependencies();
  deps.verify.mockRejectedValueOnce(
    new Error("synthetic verification failure"),
  );
  const options = parseReplayAdmissionArguments([...args(), "--apply"]);
  await expect(runReplayAdmission(options, deps)).rejects.toThrow(
    "synthetic verification failure",
  );
  expect(deps.admit).not.toHaveBeenCalled();
});

test("malformed or oversized local evidence never starts remote verification", async () => {
  const deps = dependencies();
  await Bun.write(path.join(directory, "invalid.json"), "{");
  const oversized = path.join(directory, "oversized.json");
  await Bun.write(oversized, "{}");
  await truncate(oversized, 32 * 1024 * 1024 + 1);
  await mkdir(path.join(directory, "empty-directory"));
  for (const input of [
    args("beta", "invalid.json"),
    args("beta", "publication.json", "oversized.json"),
    args("beta", "empty-directory"),
  ]) {
    const options = parseReplayAdmissionArguments([...input, "--apply"]);
    await expect(runReplayAdmission(options, deps)).rejects.toThrow();
  }
  expect(deps.verify).not.toHaveBeenCalled();
  expect(deps.admit).not.toHaveBeenCalled();
});

test("requires distinct explicit options and a known Riot platform", () => {
  expect(() => parseReplayAdmissionArguments(args().slice(0, 3))).toThrow();
  expect(() =>
    parseReplayAdmissionArguments([...args(), "--platform=EUW1"]),
  ).toThrow("--platform may appear only once");
  expect(() =>
    parseReplayAdmissionArguments([
      ...args().slice(0, 3),
      "--platform=unknown",
    ]),
  ).toThrow();
  expect(() => parseReplayAdmissionArguments(args("dev"))).toThrow();
});
