import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import * as Timers from "node:timers/promises";
import path from "node:path";
import { Context } from "@temporalio/activity";
import {
  ArtifactVersionSchema,
  PipelineDefinitionSchema,
} from "@shepherdjerred/delivery/contract";
import { createStaticArchive } from "@shepherdjerred/root-scripts/lib/static-site-archive.ts";
import type { RunOptions } from "@shepherdjerred/root-scripts/lib/run.ts";
import type * as RunModule from "@shepherdjerred/root-scripts/lib/run.ts";
import type * as S3Module from "@shepherdjerred/root-scripts/lib/s3-static-site.ts";
import * as SelectionModule from "./static-site-selection.ts";
import type { StaticActivationReceipt } from "./static-site-effects.ts";
import {
  activateStaticSelection,
  applyStaticSiteDetail,
  LIVE_STATIC_SITE_IO,
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
vi.mock("node:timers/promises", async (original) => {
  const timers = await original<typeof Timers>();
  return { ...timers, setTimeout: vi.fn(timers.setTimeout) };
});
vi.mock(
  "@shepherdjerred/root-scripts/lib/s3-static-site.ts",
  async (original) => ({
    ...(await original<typeof S3Module>()),
    s3SyncStaticSite: io.sync,
    firstS3ObjectMismatch: io.mismatch,
  }),
);
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
const cloudflarePurge = vi.fn<(init: RequestInit) => Response>();
const retryWait = vi.mocked(Timers.setTimeout);
const runtime = { signal: new AbortController().signal, heartbeat: vi.fn() };

beforeEach(async () => {
  directory = await mkdtemp("/tmp/static-native-runtime-");
  archivePath = path.join(directory, "selected.tar");
  receipt = null;
  publicHtml = undefined;
  remote.clear();
  for (const mock of Object.values(io)) mock.mockReset();
  retryWait.mockClear();
  cloudflarePurge
    .mockReset()
    .mockImplementation(() => Response.json({ success: true }));
  runtime.heartbeat.mockClear();
  runtime.signal = new AbortController().signal;
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
        ? {
            exitCode: 1,
            stdout: "",
            stderr:
              "fatal error: An error occurred (404) when calling the HeadObject operation: Not Found",
          }
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
      for (const file of await readdir(input.source))
        remote.set(file, await Bun.file(path.join(input.source, file)).text());
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
        return Promise.resolve(cloudflarePurge(init));
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

async function fixture(extraFiles = 0) {
  const source = path.join(directory, "source");
  await Bun.write(
    path.join(source, "index.html"),
    "<html>exact selected release</html>",
  );
  await Promise.all(
    Array.from({ length: extraFiles }, (_, index) =>
      Bun.write(
        path.join(source, `asset-${String(index)}.js`),
        "selected asset",
      ),
    ),
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
  expect(cloudflarePurge).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      body: JSON.stringify({
        files: [
          "https://wiki.sjer.red/",
          "https://wiki.sjer.red/index.html",
          "https://wiki.sjer.red/.delivery-release.json",
        ],
      }),
    }),
  );
  expect(receipt).toMatchObject({
    deploymentId: detail.deployment.id,
    versionSetRevisionId: detail.versionSet.id,
    archiveDigest: detail.versionSet.components["site:wiki-sjer-red"]?.digest,
  });
  expect(evidence.map((entry) => entry.kind)).toContain("reconciliation");
  expect(evidence.map((entry) => entry.kind)).toContain("acceptance");
});

test.each([
  {
    name: "an HTTP refusal with provider codes",
    response: () =>
      Response.json(
        {
          success: true,
          errors: [
            { code: "sensitive text", message: "private input" },
            { code: 10_000, message: "private input" },
            { code: 1134 },
          ],
        },
        { status: 403 },
      ),
    details: "HTTP 403, Cloudflare codes 10000, 1134",
  },
  {
    name: "a negative acknowledgement on HTTP success",
    response: () =>
      Response.json({
        success: false,
        errors: Array.from({ length: 10 }, (_, index) => ({
          code: 1140 + index,
        })),
      }),
    details:
      "HTTP 200, Cloudflare codes 1140, 1141, 1142, 1143, 1144, 1145, 1146, 1147",
  },
  {
    name: "an authorization refusal even when it includes a throttle code",
    response: () =>
      Response.json(
        { success: false, errors: [{ code: 1134 }] },
        { status: 401 },
      ),
    details: "HTTP 401, Cloudflare codes 1134",
  },
  {
    name: "invalid JSON after an HTTP failure",
    response: () => new Response("private provider body", { status: 429 }),
    details: "HTTP 429, invalid JSON response",
  },
  {
    name: "a malformed acknowledgement on HTTP success",
    response: () => Response.json({ success: "private provider body" }),
    details: "HTTP 200, invalid response envelope",
  },
])(
  "activation refuses $name with bounded purge diagnostics",
  async ({ response, details }) => {
    const detail = await fixture();
    cloudflarePurge.mockImplementationOnce(response);
    await expect(applyStaticSiteDetail(detail, runtime)).rejects.toMatchObject({
      message: `Selected static-site URL cache purge failed (batch 1/1, URL count 3, ${details})`,
    });
    expect(cloudflarePurge).toHaveBeenCalledTimes(1);
    expect(retryWait).not.toHaveBeenCalled();
  },
);

test("a later failed purge reports its batch and preserves the exact URL requests", async () => {
  const detail = await fixture(28);
  cloudflarePurge
    .mockImplementationOnce(() => Response.json({ success: true }))
    .mockImplementationOnce(() =>
      Response.json(
        { success: false, errors: [{ code: 1092 }] },
        { status: 400 },
      ),
    );
  await expect(applyStaticSiteDetail(detail, runtime)).rejects.toMatchObject({
    message:
      "Selected static-site URL cache purge failed (batch 2/2, URL count 1, HTTP 400, Cloudflare codes 1092)",
  });
  expect(cloudflarePurge).toHaveBeenCalledTimes(2);
  expect(cloudflarePurge).toHaveBeenLastCalledWith(
    expect.objectContaining({
      body: JSON.stringify({
        files: ["https://wiki.sjer.red/.delivery-release.json"],
      }),
    }),
  );
});

function throttled(status: number, retryAfter?: string) {
  return Response.json(
    { success: false, errors: status === 429 ? [] : [{ code: 1134 }] },
    {
      status,
      ...(retryAfter === undefined
        ? {}
        : { headers: { "Retry-After": retryAfter } }),
    },
  );
}

test.each([
  { status: 429, retryAfter: "3", milliseconds: 3000 },
  { status: 400, retryAfter: undefined, milliseconds: 1000 },
])(
  "activation retries throttling with a fresh ownership proof (HTTP $status)",
  async ({ status, retryAfter, milliseconds }) => {
    const detail = await fixture(28);
    const fence = vi.fn(() => Promise.resolve());
    const proofCounts: number[] = [];
    retryWait.mockResolvedValueOnce(undefined);
    cloudflarePurge.mockImplementation(() => {
      proofCounts.push(fence.mock.calls.length);
      return proofCounts.length === 1
        ? throttled(status, retryAfter)
        : Response.json({ success: true });
    });
    const evidence = await activateStaticSelection(
      SelectionModule.staticSiteSelection(detail),
      runtime,
      LIVE_STATIC_SITE_IO,
      fence,
    );
    expect(proofCounts).toEqual([3, 4, 5]);
    expect(cloudflarePurge.mock.calls[0]?.[0].body).toBe(
      cloudflarePurge.mock.calls[1]?.[0].body,
    );
    expect(retryWait).toHaveBeenCalledExactlyOnceWith(milliseconds, undefined, {
      signal: runtime.signal,
    });
    expect(evidence.map(({ kind }) => kind)).toContain("acceptance");
  },
);

test("persistent throttling stops after two retries for the same batch", async () => {
  const detail = await fixture();
  retryWait.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
  cloudflarePurge.mockImplementation(() => throttled(429));
  await expect(applyStaticSiteDetail(detail, runtime)).rejects.toThrow(
    "HTTP 429",
  );
  expect(cloudflarePurge).toHaveBeenCalledTimes(3);
  expect(retryWait.mock.calls.map(([milliseconds]) => milliseconds)).toEqual([
    1000, 2000,
  ]);
});

test("throttling cannot exhaust more than six retries across an archive", async () => {
  const detail = await fixture(105);
  for (let retry = 0; retry < 6; retry++)
    retryWait.mockResolvedValueOnce(undefined);
  cloudflarePurge.mockImplementation(() =>
    cloudflarePurge.mock.calls.length % 3 === 0
      ? Response.json({ success: true })
      : throttled(429),
  );
  await expect(applyStaticSiteDetail(detail, runtime)).rejects.toThrow(
    "batch 4/4, URL count 18, HTTP 429",
  );
  expect(cloudflarePurge).toHaveBeenCalledTimes(10);
  expect(retryWait).toHaveBeenCalledTimes(6);
});

test("a provider delay beyond the retry bound does not trigger an early POST", async () => {
  const detail = await fixture();
  cloudflarePurge.mockImplementationOnce(() => throttled(429, "6"));
  await expect(applyStaticSiteDetail(detail, runtime)).rejects.toThrow(
    "HTTP 429",
  );
  expect(cloudflarePurge).toHaveBeenCalledTimes(1);
  expect(retryWait).not.toHaveBeenCalled();
});

test("a lost ownership fence prevents a throttled request from being retried", async () => {
  const detail = await fixture();
  const fence = vi.fn(() => Promise.resolve());
  cloudflarePurge.mockImplementationOnce(() => throttled(429));
  retryWait.mockImplementationOnce(async () => {
    fence.mockRejectedValueOnce(new Error("Ownership lost"));
    await Promise.resolve();
  });
  await expect(
    activateStaticSelection(
      SelectionModule.staticSiteSelection(detail),
      runtime,
      LIVE_STATIC_SITE_IO,
      fence,
    ),
  ).rejects.toThrow("Ownership lost");
  expect(fence).toHaveBeenCalledTimes(4);
  expect(cloudflarePurge).toHaveBeenCalledTimes(1);
});

test("cancellation during purge backoff prevents a retry", async () => {
  const detail = await fixture();
  const canceled = new AbortController();
  runtime.signal = canceled.signal;
  const waiting = Promise.withResolvers<undefined>();
  const timers = await vi.importActual<typeof Timers>("node:timers/promises");
  retryWait.mockImplementationOnce((milliseconds, value, options) => {
    waiting.resolve(undefined);
    return timers.setTimeout(milliseconds, value, options);
  });
  cloudflarePurge.mockImplementationOnce(() => throttled(429, "5"));
  const outcome = expect(
    applyStaticSiteDetail(detail, runtime),
  ).rejects.toMatchObject({ name: "AbortError" });
  await waiting.promise;
  canceled.abort();
  await outcome;
  expect(cloudflarePurge).toHaveBeenCalledTimes(1);
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

test.each([
  "fatal error: An error occurred (403) when calling the HeadObject operation: Forbidden",
  "fatal error: 404 upstream gateway",
  "unexpected storage failure",
])("activation refuses a receipt read failure: %s", async (stderr) => {
  const detail = await fixture();
  io.read.mockResolvedValue({ exitCode: 1, stdout: "", stderr });
  await expect(applyStaticSiteDetail(detail, runtime)).rejects.toThrow(
    "Static activation receipt could not be read",
  );
  expect(io.sync).not.toHaveBeenCalled();
  expect(receipt).toBeNull();
});

test.each(["not JSON", JSON.stringify({ invalid: "receipt" })])(
  "activation refuses malformed receipt data: %s",
  async (stdout) => {
    const detail = await fixture();
    io.read.mockResolvedValue({ exitCode: 0, stdout, stderr: "" });
    await expect(applyStaticSiteDetail(detail, runtime)).rejects.toThrow();
    expect(io.sync).not.toHaveBeenCalled();
    expect(receipt).toBeNull();
  },
);

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
