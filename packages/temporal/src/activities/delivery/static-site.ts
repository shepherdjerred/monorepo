import { Context } from "@temporalio/activity";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { EvidenceInput } from "@shepherdjerred/delivery/contract";
import { restoreStaticArchive } from "@shepherdjerred/root-scripts/lib/static-site-archive.ts";
import {
  firstS3ObjectMismatch,
  isMissingS3Object,
  s3SyncStaticSite,
} from "@shepherdjerred/root-scripts/lib/s3-static-site.ts";
import {
  SEAWEEDFS_AWS_ENV,
  SEAWEEDFS_ENDPOINT,
} from "@shepherdjerred/root-scripts/lib/seaweedfs.ts";
import {
  requireEnv,
  run,
  runAllowExit,
} from "@shepherdjerred/root-scripts/lib/run.ts";
import {
  activateStaticArchive,
  activationReceiptMatches,
  StaticActivationReceiptSchema,
  staticAcceptanceEvidence,
  assertNoReservedStaticFiles,
} from "./static-site-effects.ts";
import type { StaticActivationReceipt } from "./static-site-effects.ts";
import { withBackupActivityHeartbeat } from "#activities/homelab/seaweedfs-backup-heartbeat.ts";
import { verifyPublicStaticEntrypoint } from "./static-site-public.ts";
import {
  staticSiteSelection as selection,
  type StaticSiteSelection,
} from "./static-site-selection.ts";

const MARKER = ".delivery-release.json";
type StaticSiteDetail = Parameters<typeof selection>[0];
type SitePolicy = StaticSiteSelection["pipeline"];
export type StaticSiteRuntime = {
  signal: AbortSignal;
  heartbeat: (details: unknown) => void;
};
/** The archive restored into scratch space for one activation or readback. */
type OpenedArchive = {
  source: string;
  scratch: string;
  files: string[];
  signal: AbortSignal;
};

/** Artifact-store, bucket and HTTP effects of a site activation; tests inject them. */
export type StaticSiteIo = {
  /** Copies the immutable archive from `delivery-artifacts` by its digest-named key. */
  download: (uri: string, file: string, signal: AbortSignal) => Promise<void>;
  readReceipt: (
    bucket: string,
    signal: AbortSignal,
  ) => Promise<StaticActivationReceipt | null>;
  writeReceipt: (
    receipt: StaticActivationReceipt,
    scratch: string,
    signal: AbortSignal,
  ) => Promise<void>;
  /** The first selected object whose served bytes differ from the archive. */
  firstMismatch: (input: {
    source: string;
    bucket: string;
    paths: string[];
    scratch: string;
    signal: AbortSignal;
  }) => Promise<string | undefined>;
  synchronize: (input: {
    source: string;
    site: SitePolicy;
    scratch: string;
    signal: AbortSignal;
  }) => Promise<void>;
  fetch: (input: string | URL, init: RequestInit) => Promise<Response>;
  cloudflareToken: () => string;
};

function awsEnvironment() {
  return {
    ...SEAWEEDFS_AWS_ENV,
    AWS_ACCESS_KEY_ID: requireEnv("DELIVERY_SITE_ACTIVATOR_ACCESS_KEY_ID"),
    AWS_SECRET_ACCESS_KEY: requireEnv(
      "DELIVERY_SITE_ACTIVATOR_SECRET_ACCESS_KEY",
    ),
  };
}

async function readReceipt(
  bucket: string,
  signal: AbortSignal,
): Promise<StaticActivationReceipt | null> {
  const result = await runAllowExit(
    [
      "aws",
      "s3",
      "cp",
      `s3://${bucket}/${MARKER}`,
      "-",
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
    ],
    {
      env: awsEnvironment(),
      capture: true,
      echoCapturedStdout: false,
      unsetEnv: ["OP_SERVICE_ACCOUNT_TOKEN"],
      signal,
    },
  );
  if (result.exitCode !== 0) {
    if (isMissingS3Object(result.stderr)) return null;
    throw new Error("Static activation receipt could not be read");
  }
  const raw: unknown = JSON.parse(result.stdout);
  return StaticActivationReceiptSchema.parse(raw);
}

async function writeReceipt(
  receipt: StaticActivationReceipt,
  scratch: string,
  signal: AbortSignal,
) {
  const file = path.join(scratch, "receipt.json");
  await Bun.write(file, `${JSON.stringify(receipt)}\n`);
  await run(
    [
      "aws",
      "s3",
      "cp",
      file,
      `s3://${receipt.bucket}/${MARKER}`,
      "--endpoint-url",
      SEAWEEDFS_ENDPOINT,
      "--cache-control",
      "no-cache",
      "--content-type",
      "application/json",
    ],
    { env: awsEnvironment(), unsetEnv: ["OP_SERVICE_ACCOUNT_TOKEN"], signal },
  );
}

/** The SeaweedFS and Cloudflare effects the site activator credential reaches. */
export const LIVE_STATIC_SITE_IO: StaticSiteIo = {
  download: async (uri, file, signal) => {
    await run(
      ["aws", "s3", "cp", uri, file, "--endpoint-url", SEAWEEDFS_ENDPOINT],
      { env: awsEnvironment(), unsetEnv: ["OP_SERVICE_ACCOUNT_TOKEN"], signal },
    );
  },
  readReceipt,
  writeReceipt,
  firstMismatch: async ({ source, bucket, paths, scratch, signal }) =>
    await firstS3ObjectMismatch({
      sourceDir: source,
      bucket,
      paths,
      scratchDir: scratch,
      endpoint: SEAWEEDFS_ENDPOINT,
      env: awsEnvironment(),
      signal,
    }),
  synchronize: async ({ source, site, scratch, signal }) => {
    await s3SyncStaticSite({
      source,
      bucket: site.bucket,
      endpoint: SEAWEEDFS_ENDPOINT,
      immutablePrefixes: site.immutablePrefixes,
      extraExcludes: [...site.extraExcludes, MARKER],
      forceMutableUpload: true,
      cwd: scratch,
      env: awsEnvironment(),
      dryRun: false,
      haveCreds: true,
      signal,
    });
  },
  fetch: async (input, init) => await fetch(input, init),
  cloudflareToken: () => requireEnv("CLOUDFLARE_API_TOKEN"),
};

export async function withStaticActivityRuntime<T>(
  operation: (runtime: StaticSiteRuntime) => Promise<T>,
): Promise<T> {
  const context = Context.current();
  return withBackupActivityHeartbeat(
    context,
    ({ signal }) =>
      operation({
        signal,
        heartbeat: (details) => {
          context.heartbeat(details);
        },
      }),
    { stage: "static-site" },
  );
}

async function withArchiveOperation<T>(
  site: StaticSiteSelection,
  inspect: (opened: OpenedArchive) => Promise<T>,
  runtime: StaticSiteRuntime,
  io: StaticSiteIo,
): Promise<T> {
  const { signal } = runtime;
  signal.throwIfAborted();
  const { archive, pipeline } = site;
  const scratch = await mkdtemp(path.join(tmpdir(), "delivery-static-"));
  try {
    const file = path.join(scratch, "archive.tar");
    const source = path.join(scratch, "site");
    runtime.heartbeat({
      deploymentId: site.receipt.deploymentId,
      phase: "archive",
    });
    await io.download(archive.uri, file, signal);
    await mkdir(source);
    const files = await restoreStaticArchive(file, source, archive.digest);
    assertNoReservedStaticFiles(files, pipeline.extraExcludes);
    for (const entrypoint of pipeline.entrypoints) {
      if (!files.includes(entrypoint))
        throw new Error(
          `Static archive is missing required entrypoint ${entrypoint}`,
        );
    }
    if (files.includes(MARKER))
      throw new Error("Static archives cannot contain the activation receipt");
    signal.throwIfAborted();
    return await inspect({ source, scratch, files, signal });
  } finally {
    await rm(scratch, { recursive: true });
  }
}

function publicUrls(pipeline: SitePolicy): string[] {
  const base = new URL(pipeline.verification.url);
  if (base.search || base.hash || base.username || base.password)
    throw new Error("Static verification requires a canonical site URL");
  return pipeline.entrypoints.map(
    (entry) =>
      new URL(
        entry.endsWith("index.html")
          ? entry.slice(0, -"index.html".length) || "./"
          : entry,
        base,
      ).href,
  );
}

async function purge(
  pipeline: SitePolicy,
  archiveFiles: string[],
  signal: AbortSignal,
  io: StaticSiteIo,
): Promise<void> {
  if (pipeline.cloudflareZoneId === undefined) return;
  const mutableFiles = archiveFiles.filter(
    (file) =>
      !pipeline.immutablePrefixes.some((prefix) => file.startsWith(prefix)),
  );
  const files = [
    ...new Set([
      ...publicUrls(pipeline),
      ...mutableFiles.map(
        (file) =>
          new URL(
            file
              .split("/")
              .map((segment) => encodeURIComponent(segment))
              .join("/"),
            pipeline.verification.url,
          ).href,
      ),
      new URL(MARKER, pipeline.verification.url).href,
    ]),
  ];
  for (let offset = 0; offset < files.length; offset += 30) {
    const response = await io.fetch(
      `https://api.cloudflare.com/client/v4/zones/${pipeline.cloudflareZoneId}/purge_cache`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${io.cloudflareToken()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ files: files.slice(offset, offset + 30) }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        redirect: "error",
      },
    );
    const raw: unknown = await response.json();
    if (
      !response.ok ||
      !z.object({ success: z.literal(true) }).safeParse(raw).success
    )
      throw new Error("Selected static-site URL cache purge failed");
  }
}

/**
 * Receipt-identified activation of an opened archive; a matching receipt only
 * re-proves bytes and purges. `fence` runs immediately before each production
 * write (the bucket sync, the receipt write and the cache purge), so a write
 * never relies on a proof taken before a long earlier one.
 */
async function activateOpened(
  site: StaticSiteSelection,
  opened: OpenedArchive,
  runtime: StaticSiteRuntime,
  { io, fence }: { io: StaticSiteIo; fence: () => Promise<void> },
): Promise<void> {
  const { pipeline, receipt } = site;
  const { source, scratch, files, signal } = opened;
  const fenced = async (write: () => Promise<void>) => {
    await fence();
    signal.throwIfAborted();
    await write();
  };
  const matchesArchive = async () =>
    (await io.firstMismatch({
      source,
      bucket: pipeline.bucket,
      paths: files,
      scratch,
      signal,
    })) === undefined;
  await activateStaticArchive(receipt, {
    readReceipt: () => io.readReceipt(pipeline.bucket, signal),
    matchesArchive,
    synchronize: () =>
      fenced(async () => {
        runtime.heartbeat({
          deploymentId: receipt.deploymentId,
          phase: "activate",
        });
        await io.synchronize({ source, site: pipeline, scratch, signal });
      }),
    writeReceipt: (value) =>
      fenced(() => io.writeReceipt(value, scratch, signal)),
    purge: () => fenced(() => purge(pipeline, files, signal, io)),
  });
}

/** Bucket receipt, bucket bytes, public entrypoint bytes and public receipt all name this deployment. */
async function verifyOpened(
  site: StaticSiteSelection,
  opened: OpenedArchive,
  io: StaticSiteIo,
): Promise<EvidenceInput[]> {
  const { pipeline, receipt } = site;
  const { source, scratch, files, signal } = opened;
  if (
    !activationReceiptMatches(
      await io.readReceipt(pipeline.bucket, signal),
      receipt,
    )
  )
    throw new Error(
      "Static bucket does not contain this deployment's activation receipt",
    );
  const mismatch = await io.firstMismatch({
    source,
    bucket: pipeline.bucket,
    paths: files,
    scratch,
    signal,
  });
  if (mismatch !== undefined)
    throw new Error("Static runtime bytes differ from the selected archive");
  const urls = publicUrls(pipeline);
  for (const [index, entrypoint] of pipeline.entrypoints.entries()) {
    const url = urls[index];
    if (url === undefined) throw new Error("Public entrypoint URL missing");
    const response = await io.fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      redirect: "manual",
    });
    await verifyPublicStaticEntrypoint({
      response,
      expectedFile: path.join(source, entrypoint),
      expectedStatus: pipeline.verification.expectedStatus,
      signal,
    });
  }
  const marker = new URL(MARKER, pipeline.verification.url);
  marker.searchParams.set("deployment", receipt.deploymentId);
  const response = await io.fetch(marker, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    redirect: "error",
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok)
    throw new Error("Public static activation receipt is unavailable");
  const raw: unknown = await response.json();
  if (
    !activationReceiptMatches(StaticActivationReceiptSchema.parse(raw), receipt)
  )
    throw new Error("Public site serves a different activation receipt");
  return staticAcceptanceEvidence(receipt, pipeline.verification.url);
}

export async function prepareStaticSite(
  detail: StaticSiteDetail,
): Promise<void> {
  await withStaticActivityRuntime((runtime) =>
    withArchiveOperation(
      selection(detail),
      () => Promise.resolve(),
      runtime,
      LIVE_STATIC_SITE_IO,
    ),
  );
}

export async function applyStaticSite(detail: StaticSiteDetail): Promise<void> {
  await withStaticActivityRuntime((runtime) =>
    applyStaticSiteDetail(detail, runtime),
  );
}

/**
 * Native repair supplies its own cancellation and heartbeat; no Activity
 * context is consulted. It holds no executor lease, so its writes are fenced
 * only by that cancellation, which every write checks.
 */
export async function applyStaticSiteDetail(
  detail: StaticSiteDetail,
  runtime: StaticSiteRuntime,
): Promise<void> {
  runtime.signal.throwIfAborted();
  const site = selection(detail);
  await withArchiveOperation(
    site,
    (opened) =>
      activateOpened(site, opened, runtime, {
        io: LIVE_STATIC_SITE_IO,
        fence: () => Promise.resolve(),
      }),
    runtime,
    LIVE_STATIC_SITE_IO,
  );
}

export async function verifyStaticSite(
  detail: StaticSiteDetail,
): Promise<EvidenceInput[]> {
  return withStaticActivityRuntime((runtime) =>
    verifyStaticSiteDetail(detail, runtime),
  );
}

/** Independent native verification shares exactly the Activity's immutable byte checks. */
export async function verifyStaticSiteDetail(
  detail: StaticSiteDetail,
  runtime: StaticSiteRuntime,
): Promise<EvidenceInput[]> {
  runtime.signal.throwIfAborted();
  const site = selection(detail);
  return await withArchiveOperation(
    site,
    (opened) => verifyOpened(site, opened, LIVE_STATIC_SITE_IO),
    runtime,
    LIVE_STATIC_SITE_IO,
  );
}

/**
 * One archive download serves a whole model step: the bytes are validated,
 * the receipt-identified activation runs (or only re-proves a bucket already
 * holding this deployment) with `beforeEffect` proving ownership immediately
 * before each of its writes, and the bucket and public site are read back
 * against the frozen archive digest.
 */
export async function activateStaticSelection(
  site: StaticSiteSelection,
  runtime: StaticSiteRuntime,
  io: StaticSiteIo,
  beforeEffect: () => Promise<void>,
): Promise<EvidenceInput[]> {
  return await withArchiveOperation(
    site,
    async (opened) => {
      await activateOpened(site, opened, runtime, { io, fence: beforeEffect });
      return await verifyOpened(site, opened, io);
    },
    runtime,
    io,
  );
}
