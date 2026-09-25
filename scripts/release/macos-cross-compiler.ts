#!/usr/bin/env bun
/**
 * Build, smoke-test, and publish the macos-cross-compiler images — one per
 * macOS SDK in packages/macos-cross-compiler/sdks.json.
 *
 *   macos-cross-compiler.ts upload <sdk>   (macOS) upload a staged SDK tarball
 *   macos-cross-compiler.ts smoke          (CI, PR) smoke stage, linux/amd64
 *   macos-cross-compiler.ts push           (CI, main) smoke, then publish
 *                                          linux/amd64 + linux/arm64
 *
 * The SDK tarballs (scripts/stage-xcode.sh) live in the private `apple-sdks`
 * SeaweedFS bucket and are pinned by sha256 in sdks.json; a mismatch fails.
 *
 * Unlike the service images (bake-images.ts), these are a public product, not
 * cluster workloads: they publish the moving tags users pull — `:<sdk>`,
 * `:<sdk>-<short sha>`, and `:latest` for the entry marked latest — and are
 * never pinned into the version catalog.
 *
 * Environment:
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  SeaweedFS (CI: deploy identity)
 *   BUILDKITE_COMMIT                          commit the images are built from
 */

import { mkdir, rm } from "node:fs/promises";
import { z } from "zod";
import { run, requireEnv } from "../lib/run.ts";
import { SEAWEEDFS_AWS_ENV, SEAWEEDFS_ENDPOINT } from "../lib/seaweedfs.ts";

const PACKAGE_DIR = "packages/macos-cross-compiler";
const IMAGE = "ghcr.io/shepherdjerred/macos-cross-compiler";
const BUCKET = "apple-sdks";
const BUILDER = "ci";

const SdkEntry = z.strictObject({
  xcode: z.string(),
  xcodeBuild: z.string(),
  swiftImage: z.string().regex(/^swift:[0-9.]+-noble$/),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  latest: z.boolean().optional(),
});
const SdksFile = z
  .object({ $comment: z.string() })
  .catchall(SdkEntry)
  .transform(({ $comment: _comment, ...sdks }) =>
    Object.entries(sdks).map(([sdk, entry]) => ({
      sdk,
      ...SdkEntry.parse(entry),
    })),
  );
type Sdk = z.output<typeof SdksFile>[number];

async function loadSdks(): Promise<Sdk[]> {
  const sdks = SdksFile.parse(
    await Bun.file(`${PACKAGE_DIR}/sdks.json`).json(),
  );
  if (sdks.filter((sdk) => sdk.latest === true).length !== 1) {
    throw new Error("sdks.json must mark exactly one entry latest");
  }
  return sdks;
}

function objectKey(sdk: Sdk): string {
  return `sdk-${sdk.sdk}.tar.zst`;
}

async function sha256(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(await Bun.file(path).arrayBuffer());
  return hasher.digest("hex");
}

/** Upload a tarball staged on this Mac, after checking it matches sdks.json. */
async function upload(sdkName: string): Promise<void> {
  const sdks = await loadSdks();
  const sdk = sdks.find((entry) => entry.sdk === sdkName);
  if (sdk === undefined) throw new Error(`sdks.json has no SDK ${sdkName}`);
  const tarball = `${PACKAGE_DIR}/.stage/${objectKey(sdk)}`;
  const digest = await sha256(tarball);
  if (digest !== sdk.sha256) {
    throw new Error(`${tarball} is ${digest}; sdks.json pins ${sdk.sha256}`);
  }
  await run(
    [
      "aws",
      "s3",
      "cp",
      tarball,
      `s3://${BUCKET}/${objectKey(sdk)}`,
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
      "--only-show-errors",
    ],
    { env: SEAWEEDFS_AWS_ENV },
  );
}

/** Download and unpack one SDK's stage into the Docker build context. */
async function fetchStage(sdk: Sdk): Promise<void> {
  const stage = `${PACKAGE_DIR}/.stage`;
  await mkdir(stage, { recursive: true });
  const tarball = `${stage}/${objectKey(sdk)}`;
  await run(
    [
      "aws",
      "s3",
      "cp",
      `s3://${BUCKET}/${objectKey(sdk)}`,
      tarball,
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
      "--only-show-errors",
    ],
    { env: SEAWEEDFS_AWS_ENV },
  );
  const digest = await sha256(tarball);
  if (digest !== sdk.sha256) {
    throw new Error(
      `${objectKey(sdk)} is ${digest}; sdks.json pins ${sdk.sha256}`,
    );
  }
  await rm(`${stage}/${sdk.sdk}`, { recursive: true, force: true });
  await run(["tar", "--zstd", "-xf", tarball, "-C", stage]);
  await rm(tarball);
}

async function ensureBuilder(): Promise<void> {
  const inspect = Bun.spawnSync(["docker", "buildx", "inspect", BUILDER]);
  if (inspect.exitCode === 0) return;
  await run([
    "docker",
    "buildx",
    "create",
    "--name",
    BUILDER,
    "--driver",
    "remote",
    "tcp://buildkitd-buildkitd-service.buildkitd.svc.cluster.local:1234",
  ]);
}

function buildArguments(sdk: Sdk, gitSha: string): string[] {
  return [
    "docker",
    "buildx",
    "build",
    "--builder",
    BUILDER,
    "--build-arg",
    `SDK=${sdk.sdk}`,
    "--build-arg",
    `SWIFT_IMAGE=${sdk.swiftImage}`,
    "--build-arg",
    `VERSION=${sdk.sdk}-${gitSha.slice(0, 12)}`,
    "--build-arg",
    `GIT_SHA=${gitSha}`,
    "--cache-from",
    `type=registry,ref=${IMAGE}:buildcache-${sdk.sdk}`,
  ];
}

async function smoke(sdk: Sdk, gitSha: string): Promise<void> {
  await run([
    ...buildArguments(sdk, gitSha),
    "--platform",
    "linux/amd64",
    "--target",
    "smoke",
    PACKAGE_DIR,
  ]);
}

async function push(sdk: Sdk, gitSha: string): Promise<void> {
  const tags = [
    sdk.sdk,
    `${sdk.sdk}-${gitSha.slice(0, 12)}`,
    ...(sdk.latest === true ? ["latest"] : []),
  ];
  await run([
    ...buildArguments(sdk, gitSha),
    "--platform",
    "linux/amd64,linux/arm64",
    "--target",
    "image",
    "--cache-to",
    `type=registry,ref=${IMAGE}:buildcache-${sdk.sdk},mode=max,image-manifest=true`,
    ...tags.flatMap((tag) => ["--tag", `${IMAGE}:${tag}`]),
    "--push",
    PACKAGE_DIR,
  ]);
}

async function main(): Promise<void> {
  const [command, argument] = Bun.argv.slice(2);
  switch (command) {
    case "upload": {
      if (argument === undefined)
        throw new Error("usage: macos-cross-compiler.ts upload <sdk>");
      await upload(argument);
      return;
    }
    case "smoke":
    case "push": {
      const gitSha = requireEnv("BUILDKITE_COMMIT");
      await ensureBuilder();
      for (const sdk of await loadSdks()) {
        await fetchStage(sdk);
        await smoke(sdk, gitSha);
        if (command === "push") await push(sdk, gitSha);
      }
      return;
    }
    case undefined:
    default:
      throw new Error(
        "usage: macos-cross-compiler.ts upload <sdk> | smoke | push",
      );
  }
}

await main();
