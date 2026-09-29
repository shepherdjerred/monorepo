/**
 * Two-pass `aws s3 sync` for static sites on SeaweedFS (ported from the old
 * CI's `s3SyncStaticSite`; extracted from scripts/release/deploy-site.ts so the scout
 * lockstep deploy scripts share the exact same sync semantics).
 */

import { createSignedS3Request } from "@shepherdjerred/s3-signed-request";
import { requireEnv, run } from "./run.ts";

const DIRECT_READBACK_THRESHOLD = 64;
const DIRECT_READBACK_CONCURRENCY = 8;

/**
 * Refuse to sync a partial static site that would delete a live entrypoint.
 *
 * `entrypoints` defaults to the two surfaces every archived Scout release has
 * ever contained. Callers working with the current bundle pass the full list
 * (which also includes `docs/index.html`); the legacy reconcile path keeps the
 * default, because archives predating the docs site legitimately lack it.
 */
export async function assertStaticSiteComplete(
  dir: string,
  label: string,
  entrypoints: readonly string[] = ["index.html", "app/index.html"],
): Promise<void> {
  for (const path of entrypoints) {
    if (!(await Bun.file(`${dir}/${path}`).exists())) {
      throw new Error(`${label}: ${dir}/${path} is missing — refusing to sync`);
    }
  }
}

/**
 * List every file owned by a static release in deterministic order. Release
 * certification uses this list for byte-for-byte readback: S3 sync's normal
 * size-and-timestamp comparison is not an integrity check.
 */
export async function staticSiteFilePaths(
  directory: string,
): Promise<string[]> {
  const paths: string[] = [];
  for await (const path of new Bun.Glob("**/*").scan({
    cwd: directory,
    onlyFiles: true,
  })) {
    paths.push(path);
  }
  return paths.sort();
}

/** Compare local files as bytes so binary static assets are certified exactly. */
export async function filesHaveSameBytes(
  expectedPath: string,
  actualPath: string,
): Promise<boolean> {
  const [expected, actual] = await Promise.all([
    Bun.file(expectedPath).bytes(),
    Bun.file(actualPath).bytes(),
  ]);
  return (
    expected.length === actual.length &&
    !expected.some((byte, index) => byte !== actual[index])
  );
}

/** AWS CLI's stable missing-key diagnostics for `s3 cp` object reads. */
export function isMissingS3Object(stderr: string): boolean {
  return (
    stderr.includes("NoSuchKey") ||
    stderr.includes("HeadObject operation: Not Found") ||
    (stderr.includes("404") && stderr.includes("does not exist"))
  );
}

/**
 * Build the forced mutable-file copy used for release archives materialized
 * locally from S3. Unlike `aws s3 sync`, `cp --recursive` overwrites matching
 * destination keys even when archive timestamps make the sync comparator think
 * a changed entrypoint is current.
 */
export function forceMutableUploadCommand(opts: {
  source: string;
  dest: string;
  endpoint: string;
  excludes: string[];
  includes?: string[];
  cacheControl?: string;
  dryRun: boolean;
}): string[] {
  return [
    "aws",
    "s3",
    "cp",
    opts.source,
    opts.dest,
    "--recursive",
    "--endpoint-url",
    opts.endpoint,
    ...opts.excludes.flatMap((pattern) => ["--exclude", pattern]),
    ...(opts.includes ?? []).flatMap((pattern) => ["--include", pattern]),
    "--cache-control",
    opts.cacheControl ?? "no-cache",
    ...(opts.dryRun ? ["--dryrun"] : []),
  ];
}

/**
 * Build the deleting sync pass for mutable site files. Forced uploads run this
 * before their overwrite pass so an eventually consistent bucket listing
 * cannot delete files that the overwrite just added.
 */
export function mutableSitePruneCommand(opts: {
  source: string;
  dest: string;
  endpoint: string;
  excludes: string[];
}): string[] {
  return [
    "aws",
    "s3",
    "sync",
    opts.source,
    opts.dest,
    "--endpoint-url",
    opts.endpoint,
    ...opts.excludes.flatMap((pattern) => ["--exclude", pattern]),
    "--cache-control",
    "no-cache",
    "--delete",
  ];
}

/**
 * Build the read-only reconciliation probe for a static-site bucket. Unlike
 * the entrypoint byte checks, this asks the AWS CLI whether *any* source file
 * would still need uploading. It catches a partial recursive upload before a
 * release marker can certify the bucket as complete.
 */
export function staticSiteSyncDryRunCommand(opts: {
  source: string;
  bucket: string;
  endpoint: string;
}): string[] {
  return [
    "aws",
    "s3",
    "sync",
    opts.source,
    `s3://${opts.bucket}/`,
    "--endpoint-url",
    opts.endpoint,
    "--dryrun",
  ];
}

/**
 * Whether an S3 bucket is missing or differs from any file in the static-site
 * source. This deliberately does not use `--delete`: retained prior hashed
 * assets are valid, but every object in the selected release must be present.
 */
export async function s3StaticSiteNeedsSync(opts: {
  source: string;
  bucket: string;
  endpoint: string;
  cwd: string;
  env: Record<string, string>;
}): Promise<boolean> {
  const result = await run(staticSiteSyncDryRunCommand(opts), {
    cwd: opts.cwd,
    env: opts.env,
    capture: true,
    echoCapturedStdout: false,
  });
  return result.stdout.trim() !== "";
}

/** Build the selected-object sync used to certify small static sites. */
export function s3StaticSiteDownloadCommand(opts: {
  bucket: string;
  destination: string;
  endpoint: string;
  paths: readonly string[];
}): string[] {
  return [
    "aws",
    "s3",
    "sync",
    `s3://${opts.bucket}/`,
    opts.destination,
    "--endpoint-url",
    opts.endpoint,
    "--exclude",
    "*",
    ...opts.paths.flatMap((path) => ["--include", path]),
  ];
}

async function sha256Stream(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of stream) {
    hasher.update(chunk);
  }
  return hasher.digest("hex");
}

async function directS3ObjectMatchesSource(
  opts: Parameters<typeof firstS3ObjectMismatch>[0],
  path: string,
): Promise<boolean> {
  const request = createSignedS3Request(
    {
      accessKeyId: requireEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("AWS_SECRET_ACCESS_KEY"),
      sessionToken: Bun.env["AWS_SESSION_TOKEN"],
      endpoint: opts.endpoint,
      bucket: opts.bucket,
      region:
        opts.env["AWS_DEFAULT_REGION"] ?? requireEnv("AWS_DEFAULT_REGION"),
      forcePathStyle: true,
    },
    { method: "GET", key: path, signal: AbortSignal.timeout(120_000) },
  );
  const response = await fetch(request);
  if (response.status === 404) {
    await response.body?.cancel();
    return false;
  }
  if (!response.ok || response.body === null) {
    await response.body?.cancel();
    throw new Error(
      `S3 readback failed for s3://${opts.bucket}/${path} (HTTP ${response.status.toString()})`,
    );
  }
  const [expected, served] = await Promise.all([
    sha256Stream(Bun.file(`${opts.sourceDir}/${path}`).stream()),
    sha256Stream(response.body),
  ]);
  return expected === served;
}

/**
 * Require every source-release object to have the same SHA-256 digest as its
 * served counterpart. Deployment markers must not advance when S3's
 * size-and-timestamp comparator skipped a changed object. Small sites use one
 * selected-object sync; large sites use bounded direct reads to avoid the AWS
 * CLI's quadratic include-filter cost and an extra copy on disk.
 */
export async function firstS3ObjectMismatch(opts: {
  sourceDir: string;
  bucket: string;
  paths: readonly string[];
  scratchDir: string;
  endpoint: string;
  env: Record<string, string>;
}): Promise<string | undefined> {
  // AWS CLI checks every include rule against every listed object. Large Scout
  // releases contain thousands of files, so read their exact keys directly
  // with bounded concurrency instead of building a quadratic sync filter.
  if (opts.paths.length > DIRECT_READBACK_THRESHOLD) {
    for (
      let offset = 0;
      offset < opts.paths.length;
      offset += DIRECT_READBACK_CONCURRENCY
    ) {
      const paths = opts.paths.slice(
        offset,
        offset + DIRECT_READBACK_CONCURRENCY,
      );
      const matches = await Promise.all(
        paths.map(
          async (path) => await directS3ObjectMatchesSource(opts, path),
        ),
      );
      const mismatch = matches.findIndex((match) => !match);
      if (mismatch !== -1) {
        return paths[mismatch];
      }
    }
    return undefined;
  }
  const servedDir = `${opts.scratchDir}/served`;
  await Bun.$`rm -rf ${servedDir}`.quiet();
  await run(
    s3StaticSiteDownloadCommand({
      bucket: opts.bucket,
      destination: servedDir,
      endpoint: opts.endpoint,
      paths: opts.paths,
    }),
    { env: opts.env },
  );
  for (const path of opts.paths) {
    const expectedPath = `${opts.sourceDir}/${path}`;
    const servedPath = `${servedDir}/${path}`;
    if (!(await Bun.file(servedPath).exists())) {
      return path;
    }
    if (!(await filesHaveSameBytes(expectedPath, servedPath))) {
      return path;
    }
  }
  return undefined;
}

export async function assertS3ObjectsMatchSource(opts: {
  sourceDir: string;
  bucket: string;
  paths: readonly string[];
  scratchDir: string;
  endpoint: string;
  env: Record<string, string>;
}): Promise<void> {
  const mismatchedPath = await firstS3ObjectMismatch(opts);
  if (mismatchedPath !== undefined) {
    throw new Error(
      `s3://${opts.bucket}/${mismatchedPath} differs from the selected source release`,
    );
  }
}

/**
 * Sync `source` to `s3://bucket/`, setting `Cache-Control` as S3 object
 * metadata (caddy-s3-proxy passes it through to the browser/CDN unchanged).
 *
 * Pass 1 uploads content-hashed/fingerprinted assets — the `immutablePrefixes`
 * (e.g. `_astro/`, `app/assets/`) — with a 1-year `immutable` Cache-Control and
 * WITHOUT `--delete`, so prior builds' hashed files survive for already-loaded
 * tabs. Pass 2 uploads everything else with `Cache-Control: no-cache` and
 * `--delete`, `--exclude`ing the hashed prefixes so retained old hashed assets
 * are left in place. When `immutablePrefixes` is empty a single `no-cache` +
 * `--delete` pass is used.
 *
 * `extraExcludes` are appended to the deleting pass's `--exclude`s: bucket
 * objects the deploy does not own and must never prune (e.g. the scout
 * `.release-version` marker, which is written separately after a successful
 * sync).
 *
 * `forceMutableUpload` is for deployments materialized from an S3 archive.
 * The archive download preserves object timestamps, so `aws s3 sync` can
 * incorrectly retain a changed mutable entrypoint when its size and timestamp
 * compare equal to the destination. When enabled, a recursive `aws s3 cp`
 * uploads every release object after the deleting sync and before the
 * immutable metadata pass, so equal-size/timestamp-corrupted mutable assets
 * repair without an eventually consistent listing deleting them again.
 */
export async function s3SyncStaticSite(opts: {
  source: string;
  bucket: string;
  endpoint: string;
  immutablePrefixes: string[];
  extraExcludes?: string[];
  forceMutableUpload?: boolean;
  cwd: string;
  env: Record<string, string>;
  dryRun: boolean;
  haveCreds: boolean;
}): Promise<void> {
  const {
    source,
    bucket,
    endpoint,
    immutablePrefixes,
    cwd,
    env,
    forceMutableUpload = false,
  } = opts;
  const extraExcludes = opts.extraExcludes ?? [];
  const dest = `s3://${bucket}/`;
  const deletePassExcludes = [
    ...immutablePrefixes.map((p) => `${p}*`),
    ...extraExcludes,
  ];

  if (opts.dryRun) {
    const plan =
      immutablePrefixes.length > 0
        ? `pass 1 [${immutablePrefixes.join(", ")}] immutable (no --delete); ` +
          `${forceMutableUpload ? "force-copy " : "sync "}everything else no-cache ` +
          `(--delete, excluding immutable prefixes)`
        : `${forceMutableUpload ? "force-copy " : "sync "}everything no-cache (--delete)`;
    console.log(
      `DRYRUN: would sync ${source} -> ${dest} via ${endpoint} — ${plan}`,
    );
    if (!opts.haveCreds) {
      console.log(
        "DRYRUN: AWS credentials absent; skipping the real `aws s3 sync --dryrun` call. " +
          "The plan above is what would run with creds present.",
      );
      return;
    }
    // Creds present — surface exactly what the sync would move via --dryrun.
    if (forceMutableUpload) {
      await run(
        [
          ...mutableSitePruneCommand({
            source,
            dest,
            endpoint,
            excludes: deletePassExcludes,
          }),
          "--dryrun",
        ],
        { cwd, env },
      );
      await run(
        forceMutableUploadCommand({
          source,
          dest,
          endpoint,
          excludes: deletePassExcludes,
          dryRun: true,
        }),
        { cwd, env },
      );
    }
    if (immutablePrefixes.length > 0) {
      if (forceMutableUpload) {
        await run(
          forceMutableUploadCommand({
            source,
            dest,
            endpoint,
            excludes: ["*"],
            includes: immutablePrefixes.map((prefix) => `${prefix}*`),
            cacheControl: "public, max-age=31536000, immutable",
            dryRun: true,
          }),
          { cwd, env },
        );
      }
      await run(
        [
          "aws",
          "s3",
          "sync",
          source,
          dest,
          "--endpoint-url",
          endpoint,
          "--exclude",
          "*",
          ...immutablePrefixes.flatMap((p) => ["--include", `${p}*`]),
          "--cache-control",
          "public, max-age=31536000, immutable",
          "--dryrun",
        ],
        { cwd, env },
      );
    }
    if (!forceMutableUpload) {
      await run(
        [
          ...mutableSitePruneCommand({
            source,
            dest,
            endpoint,
            excludes: deletePassExcludes,
          }),
          "--dryrun",
        ],
        { cwd, env },
      );
    }
    return;
  }

  // A recursive force copy is needed because release archives preserve source
  // timestamps, but SeaweedFS can return a stale listing immediately after a
  // write. Prune first, then overwrite mutable files, so the deleting sync
  // never sees files that this release has just uploaded.
  if (forceMutableUpload) {
    await run(
      mutableSitePruneCommand({
        source,
        dest,
        endpoint,
        excludes: deletePassExcludes,
      }),
      { cwd, env },
    );
    await run(
      forceMutableUploadCommand({
        source,
        dest,
        endpoint,
        excludes: deletePassExcludes,
        dryRun: false,
      }),
      { cwd, env },
    );
  }

  // Pass 1: immutable, fingerprinted assets — no --delete.
  if (immutablePrefixes.length > 0) {
    if (forceMutableUpload) {
      await run(
        forceMutableUploadCommand({
          source,
          dest,
          endpoint,
          excludes: ["*"],
          includes: immutablePrefixes.map((prefix) => `${prefix}*`),
          cacheControl: "public, max-age=31536000, immutable",
          dryRun: false,
        }),
        { cwd, env },
      );
    }
    await run(
      [
        "aws",
        "s3",
        "sync",
        source,
        dest,
        "--endpoint-url",
        endpoint,
        "--exclude",
        "*",
        ...immutablePrefixes.flatMap((p) => ["--include", `${p}*`]),
        "--cache-control",
        "public, max-age=31536000, immutable",
      ],
      { cwd, env },
    );
  }

  // Pass 2 (or single pass): everything else, no-cache + --delete, excluding
  // the immutable prefixes so `--delete` never prunes retained hashed assets.
  // Forced uploads already ran this pass before their overwrite, which avoids
  // the eventual-consistency deletion race described above.
  if (!forceMutableUpload) {
    await run(
      mutableSitePruneCommand({
        source,
        dest,
        endpoint,
        excludes: deletePassExcludes,
      }),
      { cwd, env },
    );
  }
}
