import { stat } from "node:fs/promises";
import { expect, test, vi } from "vitest";
import { createS3Client } from "#src/storage/s3-client.ts";
import {
  parseReplayPublicationArguments,
  runReplayPublication,
} from "./publish-replay-package.ts";
import type { prepareReplayPublication } from "./replay-publication/package.ts";
import type { publishReplayObject } from "./replay-publication/storage.ts";

const archiveDigest = `sha256:${"a".repeat(64)}`;
const manifestSha256 = "b".repeat(64);
const prefix = `replay-assets/16.21.829.8620/${manifestSha256}`;
const objects = [
  {
    key: `${prefix}/fixture.css`,
    path: "synthetic/staged/fixture.css",
    bytes: 10,
    sha256: "c".repeat(64),
    contentType: "text/css",
  },
  {
    key: `${prefix}/fixture.json`,
    path: "synthetic/staged/fixture.json",
    bytes: 20,
    sha256: "d".repeat(64),
    contentType: "application/json",
  },
  {
    key: `${prefix}/manifest.json`,
    path: "synthetic/staged/manifest.json",
    bytes: 99,
    sha256: manifestSha256,
    contentType: "application/json",
  },
];

function fixture() {
  const client = createS3Client();
  const destroy = vi.spyOn(client, "destroy");
  const deps = {
    createClient: vi.fn(() => client),
    prepare: vi.fn<typeof prepareReplayPublication>().mockResolvedValue({
      gameBuild: "16.21.829.8620",
      protocol: "20e09df23c66b85e",
      manifestSha256,
      objects,
    }),
    publish: vi.fn<typeof publishReplayObject>().mockResolvedValue(undefined),
  };
  return { client, deps, destroy };
}

const archivePath = "local replay package.tar.gz";
const argumentsFor = [
  `--archive=${archivePath}`,
  `--archive-sha256=${archiveDigest}`,
];

test("verification produces a stable receipt without creating a storage client", async () => {
  const { deps } = fixture();
  const options = parseReplayPublicationArguments([
    ...argumentsFor,
    "--stage=beta",
  ]);
  const receipt = await runReplayPublication(options, deps);
  expect(receipt).toMatchObject({
    outcome: "verified",
    stage: "beta",
    archiveDigest,
    manifestSha256,
    manifestUrl: `https://beta.scout-for-lol.com/${prefix}/manifest.json`,
    objects: objects.map(({ key, bytes, sha256, contentType }) => ({
      key,
      bytes,
      sha256,
      contentType,
    })),
  });
  expect(JSON.stringify(receipt)).not.toContain("synthetic/staged");
  expect(deps.createClient).not.toHaveBeenCalled();
  expect(deps.publish).not.toHaveBeenCalled();
  const preparation = deps.prepare.mock.calls[0]?.[0];
  if (preparation === undefined) throw new Error("Archive was not prepared");
  expect(preparation.archivePath).toBe(archivePath);
  expect(preparation.archiveDigest).toBe(archiveDigest);
  await expect(stat(preparation.directory)).rejects.toMatchObject({
    code: "ENOENT",
  });
});

test.each([
  ["beta", "scout-frontend-beta", "https://beta.scout-for-lol.com"],
  ["prod", "scout-frontend", "https://scout-for-lol.com"],
] as const)(
  "apply uses the exact %s static-site target and writes the manifest last",
  async (stage, bucket, origin) => {
    const { client, deps, destroy } = fixture();
    const options = parseReplayPublicationArguments([
      ...argumentsFor,
      `--stage=${stage}`,
      "--apply",
    ]);
    await expect(runReplayPublication(options, deps)).resolves.toMatchObject({
      outcome: "published",
      stage,
      bucket,
      origin,
    });
    expect(deps.publish.mock.calls).toEqual(
      objects.map((object) => [
        { client, bucket, origin: new URL(origin), object },
      ]),
    );
    expect(destroy).toHaveBeenCalledOnce();
  },
);

test("a failed object prevents manifest publication, including on a cleanly ordered retry", async () => {
  const { deps, destroy } = fixture();
  deps.publish
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("synthetic write failure"));
  const options = parseReplayPublicationArguments([
    ...argumentsFor,
    "--stage=beta",
    "--apply",
  ]);
  await expect(runReplayPublication(options, deps)).rejects.toThrow(
    "synthetic write failure",
  );
  expect(
    deps.publish.mock.calls.map(([request]) => request.object.key),
  ).toEqual(objects.slice(0, 2).map(({ key }) => key));
  expect(destroy).toHaveBeenCalledOnce();
  deps.publish.mockClear();
  await expect(runReplayPublication(options, deps)).resolves.toMatchObject({
    outcome: "published",
  });
  expect(
    deps.publish.mock.calls.map(([request]) => request.object.key),
  ).toEqual(objects.map(({ key }) => key));
});

test("apply never creates a client if local verification fails", async () => {
  const { deps } = fixture();
  deps.prepare.mockRejectedValueOnce(
    new Error("synthetic verification failure"),
  );
  const options = parseReplayPublicationArguments([
    ...argumentsFor,
    "--stage=beta",
    "--apply",
  ]);
  await expect(runReplayPublication(options, deps)).rejects.toThrow(
    "synthetic verification failure",
  );
  expect(deps.createClient).not.toHaveBeenCalled();
  expect(deps.publish).not.toHaveBeenCalled();
});

test("apply refuses preparation that would publish the manifest before an object", async () => {
  const { deps } = fixture();
  const prepared = await deps.prepare({
    archivePath,
    archiveDigest,
    directory: "unused",
  });
  deps.prepare.mockResolvedValueOnce({
    ...prepared,
    objects: [...objects].reverse(),
  });
  const options = parseReplayPublicationArguments([
    ...argumentsFor,
    "--stage=beta",
    "--apply",
  ]);
  await expect(runReplayPublication(options, deps)).rejects.toThrow(
    "must end with its manifest",
  );
  expect(deps.createClient).not.toHaveBeenCalled();
  expect(deps.publish).not.toHaveBeenCalled();
});

test("requires one explicit archive, digest and stage", () => {
  expect(() => parseReplayPublicationArguments(argumentsFor)).toThrow();
  expect(() =>
    parseReplayPublicationArguments([...argumentsFor, "--stage=dev"]),
  ).toThrow();
  expect(() =>
    parseReplayPublicationArguments([
      ...argumentsFor,
      "--stage=beta",
      "--stage=prod",
    ]),
  ).toThrow("--stage may appear only once");
  expect(() =>
    parseReplayPublicationArguments([
      "--archive=package.tar.gz",
      "--archive-sha256=bad",
      "--stage=prod",
    ]),
  ).toThrow();
});
