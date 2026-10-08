import { mkdtemp, mkdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { packTar, type TarEntry } from "modern-tar";
import { afterEach, expect, test, vi } from "vitest";
import {
  artifactDefinition,
  createCiArtifactArchive,
  restoreCiArtifactArchive,
} from "./ci-artifact-archive.ts";
import {
  artifactObjectKey,
  getCiArtifact,
  putCiArtifact,
} from "./ci-artifact.ts";
import { CI_HANDOFF_BUCKET, CI_HANDOFF_REGION } from "./ci-handoff.ts";
import { SEAWEEDFS_ENDPOINT } from "../seaweedfs.ts";

const temporaryDirectories: string[] = [];
const CONFIG = {
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  endpoint: SEAWEEDFS_ENDPOINT,
  bucket: CI_HANDOFF_BUCKET,
  region: CI_HANDOFF_REGION,
  pipelineNumber: "4218",
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(async (directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

async function temporaryRepository(): Promise<string> {
  const repository = await mkdtemp(path.join(tmpdir(), "ci-artifact-test-"));
  temporaryDirectories.push(repository);
  return repository;
}

async function compressedTar(
  entries: readonly TarEntry[],
): Promise<Uint8Array> {
  const tar = await packTar(entries);
  const body = new Response(tar).body;
  if (body === null) throw new Error("test could not create tar stream");
  return new Uint8Array(
    await new Response(
      body.pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );
}

function archiveEntries(
  manifestEntries: readonly Record<string, unknown>[],
  payloadEntries: readonly TarEntry[],
): TarEntry[] {
  const manifest = new TextEncoder().encode(
    `${JSON.stringify({
      schemaVersion: 1,
      key: "sjer-red-dist",
      entries: manifestEntries,
    })}\n`,
  );
  return [
    {
      header: { name: "manifest.json", type: "file", size: manifest.length },
      body: manifest,
    },
    ...payloadEntries,
  ];
}

test("scopes a known artifact to its pipeline", () => {
  expect(artifactObjectKey("4218", "wiki-dist")).toBe(
    "artifacts/4218/wiki-dist.tar.gz",
  );
  expect(() => artifactObjectKey("4218", "arbitrary-output")).toThrow(
    /unknown CI artifact key/u,
  );
});

test("binds each artifact key to its only accepted repository path", () => {
  expect(artifactDefinition("resume-pdf").path).toBe(
    "packages/resume/resume.pdf",
  );
  expect(artifactDefinition("sjer-red-dist").path).toBe(
    "packages/sjer.red/dist",
  );
  expect(artifactDefinition("wiki-dist").path).toBe("packages/docs/wiki/dist");
  expect(() => artifactDefinition("unknown")).toThrow(
    /unknown CI artifact key/u,
  );
});

test("round-trips the declared directory without restoring stale files", async () => {
  const repository = await temporaryRepository();
  const output = path.join(repository, "packages/sjer.red/dist");
  await mkdir(path.join(output, "assets"), { recursive: true });
  await Bun.write(path.join(output, "index.html"), "<h1>safe</h1>\n");
  await Bun.write(path.join(output, "assets/app.js"), "console.log('safe')\n");

  const archive = await createCiArtifactArchive("sjer-red-dist", repository);
  await Bun.write(path.join(output, "stale.txt"), "remove me");
  await restoreCiArtifactArchive("sjer-red-dist", archive, repository);

  expect(await readFile(path.join(output, "index.html"), "utf8")).toBe(
    "<h1>safe</h1>\n",
  );
  expect(await Bun.file(path.join(output, "stale.txt")).exists()).toBe(false);
});

test("rejects symbolic links from a producing workspace", async () => {
  const repository = await temporaryRepository();
  const output = path.join(repository, "packages/docs/wiki/dist");
  await mkdir(output, { recursive: true });
  await symlink("/etc/passwd", path.join(output, "escape"));

  await expect(
    createCiArtifactArchive("wiki-dist", repository),
  ).rejects.toThrow(/cannot contain symbolic links/u);
});

test("rejects a manifest path outside the declared output", async () => {
  const repository = await temporaryRepository();
  const archive = await compressedTar(
    archiveEntries(
      [
        {
          path: "packages/sjer.red/dist",
          type: "directory",
          mode: 493,
          size: 0,
        },
        {
          path: "../../escaped",
          type: "file",
          mode: 420,
          size: 1,
          sha256:
            "2d711642b726b04401627ca9fbac32f5da7e5c8530fb1903cc4db02258717921",
        },
      ],
      [],
    ),
  );

  await expect(
    restoreCiArtifactArchive("sjer-red-dist", archive, repository),
  ).rejects.toThrow(/unsafe path/u);
  expect(await Bun.file(path.join(repository, "escaped")).exists()).toBe(false);
});

test("rejects an archive entry that is not in the manifest", async () => {
  const repository = await temporaryRepository();
  const archive = await compressedTar(
    archiveEntries(
      [
        {
          path: "packages/sjer.red/dist",
          type: "directory",
          mode: 493,
          size: 0,
        },
      ],
      [
        {
          header: {
            name: "payload/packages/sjer.red/dist/",
            type: "directory",
            size: 0,
          },
        },
        {
          header: {
            name: "payload/packages/sjer.red/dist/extra",
            type: "symlink",
            linkname: "/etc/passwd",
            size: 0,
          },
        },
      ],
    ),
  );

  await expect(
    restoreCiArtifactArchive("sjer-red-dist", archive, repository),
  ).rejects.toThrow(/unexpected entry/u);
});

test("rejects content that does not match the manifest digest", async () => {
  const repository = await temporaryRepository();
  const archive = await compressedTar(
    archiveEntries(
      [
        {
          path: "packages/sjer.red/dist",
          type: "directory",
          mode: 493,
          size: 0,
        },
        {
          path: "packages/sjer.red/dist/index.html",
          type: "file",
          mode: 420,
          size: 1,
          sha256:
            "ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb",
        },
      ],
      [
        {
          header: {
            name: "payload/packages/sjer.red/dist/",
            type: "directory",
            size: 0,
          },
        },
        {
          header: {
            name: "payload/packages/sjer.red/dist/index.html",
            type: "file",
            size: 1,
          },
          body: "b",
        },
      ],
    ),
  );

  await expect(
    restoreCiArtifactArchive("sjer-red-dist", archive, repository),
  ).rejects.toThrow(/digest mismatch/u);
});

test("retries signed uploads with the same verified archive bytes", async () => {
  vi.spyOn(Bun, "sleep").mockResolvedValue(undefined);
  const repository = await temporaryRepository();
  const output = path.join(repository, "packages/docs/wiki/dist");
  await mkdir(output, { recursive: true });
  await Bun.write(path.join(output, "index.html"), "tested wiki bundle");
  const requests: Request[] = [];
  const bodies: Uint8Array[] = [];

  await putCiArtifact(
    "wiki-dist",
    CONFIG,
    async (request) => {
      requests.push(request);
      bodies.push(new Uint8Array(await request.arrayBuffer()));
      if (requests.length === 1) {
        throw Object.assign(new Error("connection failed"), {
          code: "ConnectionRefused",
        });
      }
      return new Response(null, { status: requests.length === 2 ? 503 : 200 });
    },
    repository,
  );

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
  const producer = await temporaryRepository();
  const producerOutput = path.join(producer, "packages/docs/wiki/dist");
  await mkdir(producerOutput, { recursive: true });
  await Bun.write(path.join(producerOutput, "index.html"), "complete bundle");
  const archive = await createCiArtifactArchive("wiki-dist", producer);
  const consumer = await temporaryRepository();
  let attempts = 0;

  await getCiArtifact(
    "wiki-dist",
    CONFIG,
    (request) => {
      expect(request.method).toBe("GET");
      attempts++;
      if (attempts === 1) {
        return Promise.resolve(
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(archive.slice(0, 8));
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
      return Promise.resolve(new Response(archive));
    },
    consumer,
  );

  expect(attempts).toBe(2);
  expect(
    await Bun.file(
      path.join(consumer, "packages/docs/wiki/dist/index.html"),
    ).text(),
  ).toBe("complete bundle");
});

test.each([403, 404])(
  "fails artifact reads with HTTP %s immediately",
  async (status) => {
    const repository = await temporaryRepository();
    let attempts = 0;
    await expect(
      getCiArtifact(
        "wiki-dist",
        CONFIG,
        () => {
          attempts++;
          return Promise.resolve(new Response("Gateway Timeout", { status }));
        },
        repository,
      ),
    ).rejects.toThrow(`HTTP ${String(status)}`);
    expect(attempts).toBe(1);
  },
);

test("does not retry a corrupt archive after a successful download", async () => {
  const repository = await temporaryRepository();
  let attempts = 0;
  await expect(
    getCiArtifact(
      "wiki-dist",
      CONFIG,
      () => {
        attempts++;
        return Promise.resolve(new Response("not a gzip archive"));
      },
      repository,
    ),
  ).rejects.toThrow();
  expect(attempts).toBe(1);
});
