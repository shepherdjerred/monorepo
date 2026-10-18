import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { Context } from "@temporalio/activity";
import {
  ArtifactVersionSchema,
  PipelineDefinitionSchema,
} from "@shepherdjerred/delivery/contract";
import { createStaticArchive } from "@shepherdjerred/root-scripts/lib/static-site-archive.ts";
import type { RunOptions } from "@shepherdjerred/root-scripts/lib/run.ts";
import type * as RunModule from "@shepherdjerred/root-scripts/lib/run.ts";
import type * as SelectionModule from "./static-site-selection.ts";
import type { StaticActivationReceipt } from "./static-site-effects.ts";
import {
  applyStaticSiteDetail,
  verifyStaticSiteDetail,
} from "./static-site.ts";

const io = vi.hoisted(() => ({
  run: vi.fn(),
  read: vi.fn(),
  sync: vi.fn(),
  mismatch: vi.fn(),
}));
vi.mock("@shepherdjerred/root-scripts/lib/run.ts", async (original) => ({
  ...(await original<typeof RunModule>()),
  run: io.run,
  runAllowExit: io.read,
}));
vi.mock("@shepherdjerred/root-scripts/lib/s3-static-site.ts", () => ({
  s3SyncStaticSite: io.sync,
  firstS3ObjectMismatch: io.mismatch,
}));
vi.mock("./static-site-selection.ts", async (original) => {
  const actual = await original<typeof SelectionModule>();
  return {
    staticSiteSelection: (
      detail: Parameters<typeof actual.staticSiteSelection>[0],
    ) =>
      actual.staticSiteSelection(detail, {
        "wiki-sjer-red": "static-sites/wiki-sjer-red",
      }),
  };
});

let directory: string;
let archivePath: string;
let receipt: StaticActivationReceipt | null;
let publicHtml: string | undefined;
const remote = new Map<string, string>();
const controller = new AbortController();
const runtime = { signal: controller.signal, heartbeat: vi.fn() };

beforeEach(async () => {
  directory = await mkdtemp("/tmp/static-native-runtime-");
  archivePath = path.join(directory, "selected.tar");
  receipt = null;
  publicHtml = undefined;
  remote.clear();
  for (const mock of Object.values(io)) mock.mockReset();
  runtime.heartbeat.mockClear();
  vi.stubEnv("DELIVERY_SITE_ACTIVATOR_ACCESS_KEY_ID", "test-static-reader");
  vi.stubEnv("DELIVERY_SITE_ACTIVATOR_SECRET_ACCESS_KEY", "test-static-secret");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "test-purge-only");
  io.run.mockImplementation(async (args: string[], options: RunOptions) => {
    expect(options.signal).toBe(runtime.signal);
    if (args[3]?.startsWith("s3://delivery-artifacts/")) {
      const destination = args[4];
      if (destination === undefined)
        throw new Error("Missing archive download destination");
      await Bun.write(destination, Bun.file(archivePath));
    } else if (args[4] === "s3://wiki-sjer-red/.delivery-release.json") {
      receipt = await Bun.file(args[3]!).json();
    } else throw new Error("Unexpected test S3 mutation");
  });
  io.read.mockImplementation(() =>
    Promise.resolve(
      receipt === null
        ? { exitCode: 1, stdout: "", stderr: "NoSuchKey" }
        : { exitCode: 0, stdout: JSON.stringify(receipt), stderr: "" },
    ),
  );
  io.sync.mockImplementation(
    async (input: {
      source: string;
      forceMutableUpload: boolean;
      signal: AbortSignal;
    }) => {
      expect(input.forceMutableUpload).toBe(true);
      expect(input.signal).toBe(runtime.signal);
      remote.set(
        "index.html",
        await Bun.file(path.join(input.source, "index.html")).text(),
      );
    },
  );
  io.mismatch.mockImplementation(
    async (input: { sourceDir: string; paths: string[] }) => {
      let mismatch: string | undefined;
      for (const file of input.paths)
        if (
          (await Bun.file(path.join(input.sourceDir, file)).text()) !==
          remote.get(file)
        ) {
          mismatch = file;
          break;
        }
      return mismatch;
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL, init?: RequestInit) => {
      const url = new URL(input);
      if (init?.method === "POST") {
        expect(url.href).toBe(
          `https://api.cloudflare.com/client/v4/zones/${"1".repeat(32)}/purge_cache`,
        );
        return Promise.resolve(Response.json({ success: true }));
      }
      return Promise.resolve(
        url.pathname === "/.delivery-release.json"
          ? Response.json(receipt)
          : new Response(publicHtml ?? remote.get("index.html"), {
              status: 200,
            }),
      );
    }),
  );
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const source = path.join(directory, "source");
  await Bun.write(
    path.join(source, "index.html"),
    "<html>exact selected release</html>",
  );
  const { digest } = await createStaticArchive(source, archivePath);
  const archive = ArtifactVersionSchema.parse({
    id: "archive/native",
    serviceId: "static-sites",
    buildId: "build/native",
    sourceRevision: "a".repeat(40),
    component: "site:wiki-sjer-red",
    kind: "archive",
    uri: `s3://delivery-artifacts/sites/wiki-sjer-red/${digest.slice(7)}.tar`,
    digest,
    version: "native",
    createdAt: "2026-10-17T00:00:00Z",
  });
  return {
    pipeline: {
      definition: PipelineDefinitionSchema.parse({
        kind: "static-site",
        archiveComponent: archive.component,
        bucket: "wiki-sjer-red",
        cloudflareZoneId: "1".repeat(32),
        verification: { url: "https://wiki.sjer.red/", expectedStatus: 200 },
      }),
    },
    environment: { id: "static-sites/wiki-sjer-red" },
    deployment: { id: "native/release", kind: "deploy" as const },
    versionSet: {
      id: "native/set",
      components: { [archive.component]: archive },
    },
  };
}

test("native activation and public verification use the explicit runtime without Activity context", async () => {
  const context = vi.spyOn(Context, "current");
  const detail = await fixture();
  await applyStaticSiteDetail(detail, runtime);
  const evidence = await verifyStaticSiteDetail(detail, runtime);
  expect(context).not.toHaveBeenCalled();
  expect(
    runtime.heartbeat.mock.calls.map(([progress]) => progress.phase),
  ).toEqual(["archive", "activate", "archive"]);
  expect(io.sync).toHaveBeenCalledTimes(1);
  expect(receipt).toMatchObject({
    deploymentId: detail.deployment.id,
    versionSetRevisionId: detail.versionSet.id,
    archiveDigest: detail.versionSet.components["site:wiki-sjer-red"]?.digest,
  });
  expect(evidence.map((entry) => entry.kind)).toContain("reconciliation");
  expect(evidence.map((entry) => entry.kind)).toContain("acceptance");
});

test("a corrupted original archive cannot write a receipt or synchronize the site", async () => {
  const detail = await fixture();
  await Bun.write(archivePath, "corrupt archive");
  await expect(applyStaticSiteDetail(detail, runtime)).rejects.toThrow(
    "checksum differs",
  );
  expect(io.sync).not.toHaveBeenCalled();
  expect(receipt).toBeNull();
});

test("native verification refuses stale public HTML even when its activation marker is exact", async () => {
  const detail = await fixture();
  await applyStaticSiteDetail(detail, runtime);
  publicHtml = "<html>stale release</html>";
  await expect(verifyStaticSiteDetail(detail, runtime)).rejects.toThrow(
    "Public static entrypoint differs from selected archive",
  );
});

test.each([applyStaticSiteDetail, verifyStaticSiteDetail])(
  "canceled native calls stop before archive or storage access",
  async (operation) => {
    const detail = await fixture();
    const canceled = new AbortController();
    canceled.abort(new Error("native operation canceled"));
    await expect(
      operation(detail, {
        signal: canceled.signal,
        heartbeat: runtime.heartbeat,
      }),
    ).rejects.toThrow("native operation canceled");
    expect(io.run).not.toHaveBeenCalled();
    expect(io.sync).not.toHaveBeenCalled();
    expect(runtime.heartbeat).not.toHaveBeenCalled();
  },
);
