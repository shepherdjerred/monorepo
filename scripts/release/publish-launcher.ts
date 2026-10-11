#!/usr/bin/env bun
/** Native Windows artifacts use the existing homelab static-site bucket. */
import { createHash } from "node:crypto";
import { mkdtemp, rm, realpath } from "node:fs/promises";
import os from "node:os";
import {
  verifyPublication,
  compareVersions,
} from "../../packages/glitter-boys-launcher/scripts/release-manifest.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createSignedS3Request,
  type SignedS3RequestConfig,
} from "../../packages/s3-signed-request/src/index.ts";
import { readProfile } from "../../packages/glitter-boys-launcher/scripts/release-profile.ts";
import { SEAWEEDFS_ENDPOINT } from "../lib/seaweedfs.ts";
import { requireEnv } from "../lib/run.ts";
import { parsePublicationRecord } from "../../packages/glitter-boys-launcher/scripts/public-release.ts";
import {
  powershell,
  run,
} from "../../packages/glitter-boys-launcher/scripts/windows-tools.ts";
const repository = fileURLToPath(new URL("../..", import.meta.url));
const root = path.join(repository, "packages", "glitter-boys-launcher");
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
export async function publicationPreflight(version: string) {
  const profile = await readProfile(root);
  const config: SignedS3RequestConfig = {
    endpoint: SEAWEEDFS_ENDPOINT,
    bucket: "glitter-boys",
    region: "us-east-1",
    forcePathStyle: true,
    accessKeyId: requireEnv("SEAWEEDFS_SITES_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("SEAWEEDFS_SITES_SECRET_ACCESS_KEY"),
  };
  const response = await fetch(
    createSignedS3Request(config, {
      method: "HEAD",
      key: "",
      signal: AbortSignal.timeout(30_000),
    }),
  );
  if (response.status !== 200)
    throw new Error(
      `Could not access publication bucket: HTTP ${String(response.status)}`,
    );
  const currentResponse = await fetch(
    createSignedS3Request(config, {
      method: "GET",
      key: `launcher/${profile.channel}.json`,
      signal: AbortSignal.timeout(30_000),
    }),
  );
  if (currentResponse.ok) {
    const current = verifyPublication(
      await currentResponse.json(),
      profile.public_keys,
      profile.channel,
      true,
    );
    if (compareVersions(version, current.version) <= 0)
      throw new Error(
        `Version ${version} is already published or older. Bump the Cargo workspace version.`,
      );
  } else if (currentResponse.status !== 404)
    throw new Error(
      `Could not inspect update channel: HTTP ${String(currentResponse.status)}`,
    );
  for (const name of [
    "launcher.zip",
    `glitter-boys_${version}_x64-setup.exe`,
  ]) {
    const existing = await fetch(
      createSignedS3Request(config, {
        method: "HEAD",
        key: `launcher/releases/${version}/${name}`,
        signal: AbortSignal.timeout(30_000),
      }),
    );
    if (existing.ok)
      throw new Error(
        `Version ${version} already has artifacts. Use release:publish to retry the prepared release, or bump the version.`,
      );
    if (existing.status !== 404)
      throw new Error(
        `Could not inspect release destination: HTTP ${String(existing.status)}`,
      );
  }
  console.log(
    `Publication credentials and unused version ${version} verified.`,
  );
}
async function upload(
  config: SignedS3RequestConfig,
  object: {
    key: string;
    body: Uint8Array;
    immutable: boolean;
    contentType: string;
    expectedETag?: string | null;
  },
) {
  const { key, body, immutable, contentType, expectedETag } = object;
  const read = await fetch(
    createSignedS3Request(config, {
      method: "GET",
      key,
      signal: AbortSignal.timeout(30_000),
    }),
  );
  if (immutable && read.ok) {
    if (hash(new Uint8Array(await read.arrayBuffer())) !== hash(body))
      throw new Error(
        `Published version already differs: ${key}. Bump the version.`,
      );
    return;
  }
  if (!read.ok && read.status !== 404)
    throw new Error(`Could not inspect ${key}: HTTP ${String(read.status)}`);
  if (
    !immutable &&
    (read.ok ? read.headers.get("etag") : null) !== expectedETag
  )
    throw new Error(
      "The update channel changed during publication; retry from its latest state",
    );
  const request = createSignedS3Request(config, {
    method: "PUT",
    key,
    body,
    contentType,
    signal: AbortSignal.timeout(60_000),
  });
  request.headers.set(
    "Cache-Control",
    immutable ? "public, max-age=31536000, immutable" : "no-cache",
  );
  setConcurrencyHeader(request, immutable, expectedETag);
  const response = await fetch(request);
  if (!response.ok)
    throw new Error(
      `Could not publish ${key}: HTTP ${String(response.status)}`,
    );
  const check = await fetch(
    createSignedS3Request(config, {
      method: "GET",
      key,
      signal: AbortSignal.timeout(60_000),
    }),
  );
  if (
    !check.ok ||
    hash(new Uint8Array(await check.arrayBuffer())) !== hash(body)
  )
    throw new Error(`Publication readback failed: ${key}`);
}
function setConcurrencyHeader(
  request: Request,
  immutable: boolean,
  expectedETag: string | null | undefined,
) {
  if (immutable || expectedETag === null)
    request.headers.set("If-None-Match", "*");
  else if (typeof expectedETag === "string")
    request.headers.set("If-Match", expectedETag);
  else
    throw new Error("A concurrency token is required to publish the channel");
}
async function publicReadback(url: string, body: Uint8Array) {
  const response = await fetch(url, {
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (
    response.status !== 200 ||
    hash(new Uint8Array(await response.arrayBuffer())) !== hash(body)
  )
    throw new Error(`Public download verification failed: ${url}`);
}
export async function publishLauncher(dryRun: boolean) {
  const profile = await readProfile(root);
  const manifestFile = Bun.file(
    path.join(root, "dist", "release", `${profile.channel}.json`),
  );
  const release = verifyPublication(
    await manifestFile.json(),
    profile.public_keys,
    profile.channel,
  );
  const directory = path.join(root, "dist", "release", release.version);
  const archive = await Bun.file(path.join(directory, "launcher.zip")).bytes();
  const installerName = `glitter-boys_${release.version}_x64-setup.exe`;
  const installer = await Bun.file(path.join(directory, installerName)).bytes();
  if (
    archive.length !== release.artifact.bytes ||
    hash(archive) !== release.artifact.sha256
  )
    throw new Error("Release archive does not match its signed manifest");
  if (process.platform !== "win32")
    throw new Error(
      "Publish from the Windows signing environment so the installer signature can be verified",
    );
  if (profile.publisher === null)
    throw new Error("Release publisher is required");
  await run(
    [
      await powershell(),
      "-NoProfile",
      "-NonInteractive",
      "-File",
      path.join(root, "scripts", "verify-signature.ps1"),
      "-Path",
      path.join(directory, installerName),
      "-Publisher",
      profile.publisher,
    ],
    root,
  );
  const scratch = await mkdtemp(
    path.join(os.tmpdir(), "glitter-release-verify-"),
  );
  try {
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    await run(
      [
        await powershell(),
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath ${quote(path.join(directory, "launcher.zip"))} -DestinationPath ${quote(scratch)}; if (@(Get-ChildItem -LiteralPath ${quote(scratch)} -Force).Count -ne 1) { throw 'Unexpected update archive contents' }`,
      ],
      root,
    );
    const payload = Bun.file(path.join(scratch, "glitter-boys.exe"));
    if (
      payload.size !== release.expanded_bytes ||
      hash(await payload.bytes()) !== release.executable_sha256
    )
      throw new Error("Update executable does not match its signed manifest");
    await run(
      [
        await powershell(),
        "-NoProfile",
        "-NonInteractive",
        "-File",
        path.join(root, "scripts/verify-signature.ps1"),
        "-Path",
        path.join(scratch, "glitter-boys.exe"),
        "-Publisher",
        profile.publisher,
      ],
      root,
    );
  } finally {
    await removeScratch(scratch);
  }
  if (dryRun) {
    console.log(
      `Validated ${release.version}: signed installer, signed executable, ZIP hashes and manifest. No uploads.`,
    );
    return;
  }
  const config: SignedS3RequestConfig = {
    endpoint: SEAWEEDFS_ENDPOINT,
    bucket: "glitter-boys",
    region: "us-east-1",
    forcePathStyle: true,
    accessKeyId: requireEnv("SEAWEEDFS_SITES_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("SEAWEEDFS_SITES_SECRET_ACCESS_KEY"),
  };
  // Never downgrade the channel, even if an old release directory is selected.
  const currentResponse = await fetch(
    createSignedS3Request(config, {
      method: "GET",
      key: `launcher/${profile.channel}.json`,
      signal: AbortSignal.timeout(30_000),
    }),
  );
  if (currentResponse.ok) {
    if (currentResponse.headers.get("etag") === null)
      throw new Error("Update channel has no concurrency token");
    const current = verifyPublication(
      await currentResponse.json(),
      profile.public_keys,
      profile.channel,
      true,
    );
    if (compareVersions(current.version, release.version) > 0)
      throw new Error("Refusing to downgrade the update channel");
  } else if (currentResponse.status !== 404)
    throw new Error(
      `Could not inspect update channel: HTTP ${String(currentResponse.status)}`,
    );
  const prefix = `launcher/releases/${release.version}`;
  await upload(config, {
    key: `${prefix}/launcher.zip`,
    body: archive,
    immutable: true,
    contentType: "application/zip",
  });
  await upload(config, {
    key: `${prefix}/${installerName}`,
    body: installer,
    immutable: true,
    contentType: "application/vnd.microsoft.portable-executable",
  });
  await publicReadback(release.artifact.url, archive);
  await publicReadback(
    `https://glitter-boys.com/${prefix}/${installerName}`,
    installer,
  );
  const manifest = await manifestFile.bytes();
  await upload(config, {
    key: `launcher/${profile.channel}.json`,
    body: manifest,
    immutable: false,
    contentType: "application/json",
    expectedETag: currentResponse.ok
      ? currentResponse.headers.get("etag")
      : null,
  });
  await publicReadback(profile.manifest_url, manifest);
  const published = parsePublicationRecord({
    schema: 1,
    release: {
      version: release.version,
      expires: release.expires,
      installer: {
        url: `https://glitter-boys.com/${prefix}/${installerName}`,
        bytes: installer.length,
        sha256: hash(installer),
      },
    },
  });
  await Bun.write(
    path.join(root, "published-release.json"),
    JSON.stringify(published, null, 2) + "\n",
  );
  console.log(`Published and publicly verified launcher ${release.version}.`);
  console.log(
    "Review and commit published-release.json before deploying the download page.",
  );
}
async function removeScratch(scratch: string) {
  const tempRoot = await realpath(os.tmpdir());
  const resolved = await realpath(scratch);
  if (
    path.dirname(resolved) !== tempRoot ||
    !path.basename(resolved).startsWith("glitter-release-verify-")
  )
    throw new Error(
      "Release verification directory must remain under the temporary directory",
    );
  await rm(resolved, { recursive: true, force: true });
}
if (import.meta.main) await publishLauncher(process.argv.includes("--dry-run"));
