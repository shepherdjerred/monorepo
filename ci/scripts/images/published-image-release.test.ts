import { expect, test, vi } from "vitest";
import {
  readPublishedImageRelease,
  recordPublishedImageRelease,
  resolvePublishedImageCatalog,
  writePublishedImageRelease,
  type PublishedImageRelease,
} from "../../../scripts/lib/ci/published-image-release.ts";
import type { CiHandoffConfig } from "../../../scripts/lib/ci/ci-handoff.ts";
import type { LiveCatalogExecutor } from "./live-version-catalog.ts";

const config: CiHandoffConfig = {
  endpoint: "https://s3.test",
  bucket: "ci-handoff",
  region: "us-east-1",
  accessKeyId: "test-key",
  secretAccessKey: "test-secret",
  pipelineNumber: "8003",
};
const COMMIT = "a".repeat(40);
const NEW_COMMIT = "b".repeat(40);
const candidate = "worker/workflows/candidate";
const pin = (build: number) =>
  `2.0.0-${build.toString()}@sha256:${"a".repeat(64)}`;
function catalog(build: number, key = "worker") {
  return JSON.stringify({
    $schema: "./schema.json",
    schemaVersion: 1,
    entries: [
      {
        name: key,
        value: pin(build),
        category: "internal-image",
        artifactType: "image",
        management: { managed: false },
      },
    ],
  });
}
function release(pipelineNumber = 8002, key = "worker"): PublishedImageRelease {
  return {
    schema: "published-image-release/v1",
    pipelineNumber,
    commit: COMMIT,
    versionCatalog: catalog(1_008_001, key),
    pinCandidates: JSON.stringify({
      schema: "pin-candidates/v1",
      buildNumber: 1_008_002,
      candidates: {
        [key]: {
          version: "2.0.0-1008002",
          digest: `sha256:${"a".repeat(64)}`,
          gitSha: COMMIT,
        },
      },
    }),
  };
}
function executor(
  main = catalog(1_008_001),
  state?: {
    schema: string;
    pins: object;
    withdrawnCandidates?: Record<string, number>;
  },
): LiveCatalogExecutor {
  return async (command) => ({
    exitCode: 0,
    stderr: "",
    stdout:
      command[2] === "origin/main:scripts/pin-candidates-state.json"
        ? JSON.stringify(
            state ?? { schema: "pin-candidates-state/v1", pins: {} },
          )
        : command[1] === "show"
          ? main
          : "",
  });
}
const environment = {
  CI_PIPELINE_NUMBER: "8003",
  CI_LAST_IMAGE_RELEASE_COMMIT: "c".repeat(40),
  CI_LAST_IMAGE_RELEASE_PIPELINE: "7999",
};

test("an absent publication head bootstraps, while API failures fail loudly", async () => {
  await expect(
    readPublishedImageRelease(
      config,
      async () => new Response(null, { status: 404 }),
    ),
  ).resolves.toBeUndefined();
  await expect(
    readPublishedImageRelease(
      config,
      async () => new Response(null, { status: 500 }),
    ),
  ).rejects.toThrow("Cannot read published image release");
  await expect(
    readPublishedImageRelease(config, async () => Response.json(release())),
  ).resolves.toEqual(release());
});

test.each([
  {},
  { ...release(), versionCatalog: "{}" },
  { ...release(), pinCandidates: "{" },
  { ...release(), commit: NEW_COMMIT },
  { ...release(), versionCatalog: catalog(1_008_001, "unknown") },
])("rejects invalid or inconsistent published records: %j", async (value) => {
  await expect(
    readPublishedImageRelease(config, async () => Response.json(value)),
  ).rejects.toThrow();
});

test("writes one complete publication record under the serialized image lane", async () => {
  const value = release(8003);
  const writes: unknown[] = [];
  await writePublishedImageRelease(value, config, async (request) => {
    expect(new URL(request.url).pathname).toBe(
      "/ci-handoff/published-images/main.json",
    );
    expect(request.signal).toBeDefined();
    expect(request.redirect).toBe("error");
    if (request.method === "GET") return new Response(null, { status: 404 });
    writes.push(await request.json());
    return new Response(null, { status: 200 });
  });
  expect(writes).toEqual([value]);
});

test("never overwrites a newer head or a conflicting record for the same pipeline", async () => {
  for (const previous of [
    release(8004),
    { ...release(8003), versionCatalog: catalog(1_008_000) },
  ]) {
    const fetcher = vi.fn(async () => Response.json(previous));
    await expect(
      writePublishedImageRelease(release(8003), config, fetcher),
    ).rejects.toThrow("equal or newer");
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
  const fetcher = vi.fn(async () => Response.json(release(8003)));
  await writePublishedImageRelease(release(8003), config, fetcher);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await expect(
    writePublishedImageRelease(release(8002), config, fetcher),
  ).rejects.toThrow("does not belong to this pipeline");
});

test("publication write failure has no blind retry", async () => {
  const methods: string[] = [];
  await expect(
    writePublishedImageRelease(release(8003), config, async (request) => {
      methods.push(request.method);
      return new Response(null, {
        status: request.method === "GET" ? 404 : 500,
      });
    }),
  ).rejects.toThrow("Cannot publish image release");
  expect(methods).toEqual(["GET", "PUT"]);
});

test("refreshes a queued pipeline's stale baseline from the most recent publication", async () => {
  const value = await resolvePublishedImageCatalog(
    NEW_COMMIT,
    executor(),
    environment,
    { readLatest: async () => release() },
  );
  expect(value.baseCommit).toBe(COMMIT);
  expect(JSON.parse(value.catalog).entries[0].value).toBe(pin(1_008_002));
});

test("honors a reviewed candidate withdrawal when reading the durable head", async () => {
  const state = {
    schema: "pin-candidates-state/v1",
    pins: {},
    withdrawnCandidates: { [candidate]: 1_008_002 },
  };
  const value = await resolvePublishedImageCatalog(
    NEW_COMMIT,
    executor(catalog(1_007_000, candidate), state),
    environment,
    { readLatest: async () => release(8002, candidate) },
  );
  expect(JSON.parse(value.catalog).entries[0].value).toBe(pin(1_007_000));
});

test("rejects an already published or superseded pipeline before building", async () => {
  for (const number of [8003, 8004]) {
    const run = vi.fn(executor());
    await expect(
      resolvePublishedImageCatalog(NEW_COMMIT, run, environment, {
        readLatest: async () => release(number),
      }),
    ).rejects.toThrow("recover with a new full main pipeline");
    expect(run).not.toHaveBeenCalled();
  }
});

test("refuses a publication outside the current source ancestry", async () => {
  const read = executor();
  await expect(
    resolvePublishedImageCatalog(
      NEW_COMMIT,
      async (command) =>
        command[1] === "merge-base"
          ? { exitCode: 1, stdout: "", stderr: "" }
          : read(command),
      environment,
      { readLatest: async () => release() },
    ),
  ).rejects.toThrow("outside the current source ancestry");
});

test("bootstraps from the extension's validated baseline before the first head exists", async () => {
  const published = release();
  const reads: string[] = [];
  const value = await resolvePublishedImageCatalog(
    NEW_COMMIT,
    executor(),
    environment,
    {
      readLatest: () => Promise.resolve(undefined),
      readHandoff: async (key, pipeline) => {
        reads.push(`${pipeline}/${key}`);
        return key === "version-catalog"
          ? published.versionCatalog
          : published.pinCandidates;
      },
    },
  );
  expect(value.baseCommit).toBe(environment.CI_LAST_IMAGE_RELEASE_COMMIT);
  expect(reads).toEqual(["7999/version-catalog", "7999/pin-candidates"]);
});

test("records publication only after both current-pipeline handoffs exist", async () => {
  const value = release(8003);
  const writes: unknown[] = [];
  const fetcher = async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/8003/version-catalog.json"))
      return new Response(value.versionCatalog);
    if (path.endsWith("/8003/pin-candidates.json"))
      return new Response(value.pinCandidates);
    if (request.method === "GET") return Response.json(release(8002));
    writes.push(await request.json());
    return new Response(null, { status: 200 });
  };
  await recordPublishedImageRelease(COMMIT, "1008002", config, fetcher);
  expect(writes).toEqual([value]);
  await expect(
    recordPublishedImageRelease(COMMIT, "1008003", config, fetcher),
  ).rejects.toThrow("do not belong to this release");
  await expect(
    recordPublishedImageRelease(
      COMMIT,
      "1008002",
      config,
      async () => new Response(null, { status: 404 }),
    ),
  ).rejects.toThrow("required CI handoff");
  expect(writes).toHaveLength(1);
});
