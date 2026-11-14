// Operator-run publication of one Scout Desktop release to its update channel.
//
//   bun run release:publish:stable -- --notes-file notes.md [--dry-run]
//   bun run release:publish:beta   -- --notes-file notes.md [--dry-run]
//
// Inputs are the signed installer and its `.sig` that `release:package:<channel>`
// left in `dist/<channel>/`. The script verifies the signature with the
// channel's public key, builds the manifest, refuses to downgrade the live
// channel, uploads the immutable release objects, publishes the manifest under
// an ETag precondition, and reads everything back from the public host.
//
// Never run from CI and never against the live bucket without an operator.
// `--dry-run` does everything except upload and needs no credentials.
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SEAWEEDFS_ENDPOINT } from "../../../../../scripts/lib/seaweedfs.ts";
import { requireEnv } from "../../../../../scripts/lib/run.ts";
import { verifyMinisign } from "../../data/src/scout-client/desktop-update-minisign.ts";
import {
  ScoutDesktopUpdateChannelSchema,
  ScoutDesktopUpdateManifestSchema,
  SCOUT_DESKTOP_UPDATE_LIMITS,
  type ScoutDesktopUpdateChannel,
} from "../../data/src/scout-client/desktop-update-manifest.schema.ts";
import {
  assertNeverDowngrade,
  buildUpdateManifest,
  channelManifestKey,
  publicUrl,
  releaseObjectKey,
} from "../../data/src/scout-client/desktop-update-release.ts";
import {
  RELEASE_BUCKET,
  publicReadback,
  putChannelManifest,
  putImmutable,
  readObject,
  type Bucket,
} from "./release-bucket.ts";

const root = fileURLToPath(new URL("..", import.meta.url));

type Options = {
  channel: ScoutDesktopUpdateChannel;
  dryRun: boolean;
  notesFile: string;
  minimumVersion: string | undefined;
};

function parseOptions(argv: string[]): Options {
  const [channelArgument, ...rest] = argv;
  const channel = ScoutDesktopUpdateChannelSchema.parse(channelArgument);
  const value = (flag: string) => {
    const index = rest.indexOf(flag);
    return index === -1 ? undefined : rest[index + 1];
  };
  const notesFile = value("--notes-file");
  if (notesFile === undefined) {
    throw new Error("--notes-file <path> is required: the release notes");
  }
  return {
    channel,
    dryRun: rest.includes("--dry-run"),
    notesFile,
    minimumVersion: value("--minimum-version"),
  };
}

async function workspaceVersion(): Promise<string> {
  const cargo = await readFile(join(root, "Cargo.toml"), "utf8");
  const version = /^version = "([^"]+)"/m.exec(cargo)?.[1];
  if (version === undefined) {
    throw new Error("Cargo.toml has no workspace version");
  }
  return version;
}

async function readUpdateKey(channel: string): Promise<string> {
  const profile: unknown = JSON.parse(
    await readFile(join(root, `release-profiles/${channel}.json`), "utf8"),
  );
  if (
    typeof profile !== "object" ||
    profile === null ||
    !("update_public_key" in profile) ||
    typeof profile.update_public_key !== "string"
  ) {
    throw new Error(
      `release-profiles/${channel}.json has no update_public_key`,
    );
  }
  return profile.update_public_key;
}

/** The installer `cargo packager` wrote for `version`, and its signature. */
async function readSignedInstaller(channel: string, version: string) {
  const directory = join(root, "dist", channel);
  const suffix = `_${version}_x64-setup.exe`;
  const matches = (await readdir(directory)).filter((name) =>
    name.endsWith(suffix),
  );
  const [name, ...others] = matches;
  if (name === undefined || others.length > 0) {
    throw new Error(
      `Expected exactly one *${suffix} in ${directory}; run release:package:${channel} for ${version}`,
    );
  }
  const body = new Uint8Array(await readFile(join(directory, name)));
  const signature = (
    await readFile(join(directory, `${name}.sig`), "utf8")
  ).trim();
  return { body, signature };
}

function openBucket(): Bucket {
  return {
    config: {
      endpoint: SEAWEEDFS_ENDPOINT,
      bucket: RELEASE_BUCKET,
      region: "us-east-1",
      forcePathStyle: true,
      accessKeyId: requireEnv("SEAWEEDFS_SITES_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("SEAWEEDFS_SITES_SECRET_ACCESS_KEY"),
    },
    fetcher: fetch,
  };
}

async function readLiveManifest(bucket: Bucket, key: string) {
  const live = await readObject(bucket, key);
  if (live === null) return { manifest: null, etag: null };
  if (live.etag === null) {
    throw new Error("The update channel has no concurrency token");
  }
  const manifest = ScoutDesktopUpdateManifestSchema.parse(
    JSON.parse(new TextDecoder().decode(live.body)),
  );
  return { manifest, etag: live.etag };
}

export async function publishRelease(options: Options): Promise<void> {
  const { channel } = options;
  const version = await workspaceVersion();
  const installer = await readSignedInstaller(channel, version);

  // The same check the client makes, before anything leaves this machine.
  verifyMinisign({
    publicKeyBase64: await readUpdateKey(channel),
    signatureBase64: installer.signature,
    data: installer.body,
  });

  const notes = (await readFile(options.notesFile, "utf8")).trim();
  const fileName = `scout-desktop-${channel}_${version}_x64-setup.exe`;
  const sha256 = createHash("sha256").update(installer.body).digest("hex");
  const draft = (minimumVersion: string) =>
    buildUpdateManifest({
      channel,
      version,
      minimumVersion,
      notes,
      publishedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      windows: {
        fileName,
        sha256,
        size: installer.body.length,
        signature: installer.signature,
        format: "nsis",
      },
    });

  if (options.dryRun) {
    const manifest = draft(options.minimumVersion ?? version);
    console.log(
      `Validated ${channel} ${version}: the installer is signed by the channel key, and the manifest follows the contract. No uploads.`,
    );
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  const bucket = openBucket();
  const manifestKey = channelManifestKey(channel);
  const live = await readLiveManifest(bucket, manifestKey);
  const manifest = draft(
    options.minimumVersion ?? live.manifest?.minimumVersion ?? version,
  );
  // Never downgrade the channel, even if an old build directory is selected.
  assertNeverDowngrade(live.manifest, manifest);

  const encoder = new TextEncoder();
  const installerKey = releaseObjectKey(version, fileName);
  const signatureKey = `${installerKey}.sig`;
  await putImmutable(bucket, {
    key: installerKey,
    body: installer.body,
    contentType: "application/vnd.microsoft.portable-executable",
  });
  await putImmutable(bucket, {
    key: signatureKey,
    body: encoder.encode(installer.signature),
    contentType: "text/plain; charset=utf-8",
  });
  await publicReadback(publicUrl(installerKey), installer.body);
  await publicReadback(
    publicUrl(signatureKey),
    encoder.encode(installer.signature),
  );

  // The manifest goes last: until it lands, no client can see the release.
  const body = encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
  if (body.length > SCOUT_DESKTOP_UPDATE_LIMITS.manifestMaxBytes) {
    throw new Error("The manifest exceeds the contract's size limit");
  }
  await putChannelManifest(bucket, {
    key: manifestKey,
    body,
    expectedETag: live.etag,
  });
  await publicReadback(publicUrl(manifestKey), body);
  console.log(`Published and publicly verified ${channel} ${version}.`);
}

if (import.meta.main) {
  await publishRelease(parseOptions(process.argv.slice(2)));
}
