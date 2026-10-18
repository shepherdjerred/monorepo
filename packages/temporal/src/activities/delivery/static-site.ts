import { Context } from "@temporalio/activity";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { EvidenceInput } from "@shepherdjerred/delivery/contract";
import { restoreStaticArchive } from "@shepherdjerred/root-scripts/lib/static-site-archive.ts";
import {
  firstS3ObjectMismatch,
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
import { staticSiteSelection as selection } from "./static-site-selection.ts";

const MARKER = ".delivery-release.json";
type StaticSiteDetail = Parameters<typeof selection>[0];
export type StaticSiteRuntime = {
  signal: AbortSignal;
  heartbeat: (details: unknown) => void;
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

async function withStaticActivityRuntime<T>(
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
  detail: StaticSiteDetail,
  inspect: (input: {
    source: string;
    scratch: string;
    files: string[];
    signal: AbortSignal;
  }) => Promise<T>,
  runtime: StaticSiteRuntime,
): Promise<T> {
  const { signal } = runtime;
  signal.throwIfAborted();
  const { archive, pipeline } = selection(detail);
  const scratch = await mkdtemp(path.join(tmpdir(), "delivery-static-"));
  try {
    const file = path.join(scratch, "archive.tar");
    const source = path.join(scratch, "site");
    runtime.heartbeat({
      deploymentId: detail.deployment.id,
      phase: "archive",
    });
    await run(
      [
        "aws",
        "s3",
        "cp",
        archive.uri,
        file,
        "--endpoint-url",
        SEAWEEDFS_ENDPOINT,
      ],
      { env: awsEnvironment(), unsetEnv: ["OP_SERVICE_ACCOUNT_TOKEN"], signal },
    );
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
    if (
      result.stderr.includes("NoSuchKey") ||
      (result.stderr.includes("404") &&
        result.stderr.includes("does not exist"))
    )
      return null;
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

function publicUrls(detail: StaticSiteDetail): string[] {
  const { pipeline } = selection(detail);
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
  detail: StaticSiteDetail,
  archiveFiles: string[],
  signal: AbortSignal,
): Promise<void> {
  const { pipeline } = selection(detail);
  if (pipeline.cloudflareZoneId === undefined) return;
  const mutableFiles = archiveFiles.filter(
    (file) =>
      !pipeline.immutablePrefixes.some((prefix) => file.startsWith(prefix)),
  );
  const files = [
    ...new Set([
      ...publicUrls(detail),
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
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/zones/${pipeline.cloudflareZoneId}/purge_cache`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${requireEnv("CLOUDFLARE_API_TOKEN")}`,
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

export async function prepareStaticSite(
  detail: StaticSiteDetail,
): Promise<void> {
  await withStaticActivityRuntime((runtime) =>
    withArchiveOperation(detail, () => Promise.resolve(), runtime),
  );
}

export async function applyStaticSite(detail: StaticSiteDetail): Promise<void> {
  await withStaticActivityRuntime((runtime) =>
    applyStaticSiteDetail(detail, runtime),
  );
}

/** Native repair supplies its own cancellation and heartbeat; no Activity context is consulted. */
export async function applyStaticSiteDetail(
  detail: StaticSiteDetail,
  runtime: StaticSiteRuntime,
): Promise<void> {
  runtime.signal.throwIfAborted();
  const { pipeline, receipt } = selection(detail);
  await withArchiveOperation(
    detail,
    async ({ source, scratch, files, signal }) => {
      const matchesArchive = async () =>
        (await firstS3ObjectMismatch({
          sourceDir: source,
          bucket: pipeline.bucket,
          paths: files,
          scratchDir: scratch,
          endpoint: SEAWEEDFS_ENDPOINT,
          env: awsEnvironment(),
          signal,
        })) === undefined;
      await activateStaticArchive(receipt, {
        readReceipt: () => readReceipt(pipeline.bucket, signal),
        matchesArchive,
        synchronize: async () => {
          runtime.heartbeat({
            deploymentId: detail.deployment.id,
            phase: "activate",
          });
          await s3SyncStaticSite({
            source,
            bucket: pipeline.bucket,
            endpoint: SEAWEEDFS_ENDPOINT,
            immutablePrefixes: pipeline.immutablePrefixes,
            extraExcludes: [...pipeline.extraExcludes, MARKER],
            forceMutableUpload: true,
            cwd: scratch,
            env: awsEnvironment(),
            dryRun: false,
            haveCreds: true,
            signal,
          });
        },
        writeReceipt: (value) => writeReceipt(value, scratch, signal),
        purge: () => purge(detail, files, signal),
      });
    },
    runtime,
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
  const { pipeline, receipt } = selection(detail);
  await withArchiveOperation(
    detail,
    async ({ source, scratch, files, signal }) => {
      if (
        !activationReceiptMatches(
          await readReceipt(pipeline.bucket, signal),
          receipt,
        )
      )
        throw new Error(
          "Static bucket does not contain this deployment's activation receipt",
        );
      const mismatch = await firstS3ObjectMismatch({
        sourceDir: source,
        bucket: pipeline.bucket,
        paths: files,
        scratchDir: scratch,
        endpoint: SEAWEEDFS_ENDPOINT,
        env: awsEnvironment(),
        signal,
      });
      if (mismatch !== undefined)
        throw new Error(
          "Static runtime bytes differ from the selected archive",
        );
      const urls = publicUrls(detail);
      for (const [index, entrypoint] of pipeline.entrypoints.entries()) {
        const url = urls[index];
        if (url === undefined) throw new Error("Public entrypoint URL missing");
        const response = await fetch(url, {
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
      const response = await fetch(marker, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
        redirect: "error",
        headers: { "Cache-Control": "no-cache" },
      });
      if (!response.ok)
        throw new Error("Public static activation receipt is unavailable");
      const raw: unknown = await response.json();
      if (
        !activationReceiptMatches(
          StaticActivationReceiptSchema.parse(raw),
          receipt,
        )
      )
        throw new Error("Public site serves a different activation receipt");
    },
    runtime,
  );
  return staticAcceptanceEvidence(receipt, pipeline.verification.url);
}
