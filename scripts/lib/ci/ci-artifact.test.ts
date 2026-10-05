import { afterEach, expect, test, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { getCiArtifact, putCiArtifact } from "./ci-artifact.ts";
import { CI_HANDOFF_BUCKET, CI_HANDOFF_REGION } from "./ci-handoff.ts";
import { SEAWEEDFS_ENDPOINT } from "../seaweedfs.ts";

const CONFIG = {
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  endpoint: SEAWEEDFS_ENDPOINT,
  bucket: CI_HANDOFF_BUCKET,
  region: CI_HANDOFF_REGION,
  pipelineNumber: "4218",
};
const cleanup: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const target of cleanup.splice(0)) {
    await rm(target, { recursive: true, force: true });
  }
});

function artifactKey(): string {
  const key = `test-${randomUUID()}`;
  cleanup.push(
    path.join(Bun.env["TMPDIR"] ?? "/tmp", `ci-artifact-${key}.tar.gz`),
  );
  return key;
}

async function fixtureDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "ci-artifact-test-"));
  cleanup.push(directory);
  return directory;
}

test("retries signed uploads with the exact same archive bytes after consumed requests fail", async () => {
  vi.spyOn(Bun, "sleep").mockResolvedValue(undefined);
  const directory = await fixtureDirectory();
  await Bun.write(path.join(directory, "tested.txt"), "tested wiki bundle");
  const key = artifactKey();
  const requests: Request[] = [];
  const bodies: Uint8Array[] = [];
  await putCiArtifact(key, [directory], CONFIG, async (request) => {
    requests.push(request);
    bodies.push(new Uint8Array(await request.arrayBuffer()));
    if (requests.length === 1) {
      throw Object.assign(new Error("connection failed"), {
        code: "ConnectionRefused",
      });
    }
    return new Response(null, { status: requests.length === 2 ? 503 : 200 });
  });
  expect(requests).toHaveLength(3);
  expect(new Set(requests).size).toBe(3);
  expect(requests.every((request) => request.method === "PUT")).toBe(true);
  expect(requests.every((request) => request.url === requests[0]?.url)).toBe(
    true,
  );
  expect(bodies[0]?.byteLength).toBeGreaterThan(0);
  expect(bodies[1]).toEqual(bodies[0]);
  expect(bodies[2]).toEqual(bodies[0]);
});

test("retries an interrupted download before restoring any artifact", async () => {
  vi.spyOn(Bun, "sleep").mockResolvedValue(undefined);
  const directory = await fixtureDirectory();
  const archive = path.join(directory, "empty.tar.gz");
  const child = Bun.spawn([
    "tar",
    "-czf",
    archive,
    "--files-from",
    "/dev/null",
  ]);
  expect(await child.exited).toBe(0);
  const body = await Bun.file(archive).bytes();
  let attempts = 0;
  await getCiArtifact(artifactKey(), CONFIG, (request) => {
    expect(request.method).toBe("GET");
    attempts++;
    if (attempts === 1) {
      return Promise.resolve(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(body.slice(0, 8));
              controller.error(
                Object.assign(new Error("download interrupted"), {
                  code: "ConnectionClosed",
                }),
              );
            },
          }),
        ),
      );
    }
    return Promise.resolve(new Response(body));
  });
  expect(attempts).toBe(2);
});

test.each([403, 404])(
  "fails artifact reads with HTTP %s immediately",
  async (status) => {
    let attempts = 0;
    await expect(
      getCiArtifact(artifactKey(), CONFIG, () => {
        attempts++;
        return Promise.resolve(new Response("Gateway Timeout", { status }));
      }),
    ).rejects.toThrow(`HTTP ${String(status)}`);
    expect(attempts).toBe(1);
  },
);

test("a corrupt archive remains a hard failure after a successful download", async () => {
  let attempts = 0;
  await expect(
    getCiArtifact(artifactKey(), CONFIG, () => {
      attempts++;
      return Promise.resolve(new Response("not a gzip archive"));
    }),
  ).rejects.toThrow("tar failed");
  expect(attempts).toBe(1);
});
