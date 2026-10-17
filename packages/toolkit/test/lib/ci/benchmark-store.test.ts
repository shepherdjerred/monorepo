import { beforeEach, expect, test, vi } from "vitest";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { inspectBenchmark } from "#lib/ci/benchmark-store.ts";

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  destroy: vi.fn(),
  pipeline: vi.fn(),
  client: vi.fn(),
}));
vi.mock("#lib/s3/client.ts", () => ({ createS3Client: mocks.client }));
vi.mock("#lib/woodpecker/ci.ts", () => ({
  getPipeline: mocks.pipeline,
  WOODPECKER_URL: "https://woodpecker.sjer.red",
}));

const config = {
  baseUrl: "https://woodpecker.sjer.red",
  token: "private-token",
  repoId: 1,
};
const options = {
  head: "a".repeat(40),
  variant: "candidate" as const,
  profile: "explicit-profile",
  archive: false,
};
function pipeline() {
  return {
    number: 123,
    commit: options.head,
    branch: "ci-canary/test",
    event: "manual",
    status: "success",
    rerun_count: 0,
    workflows: [{ name: "verify", state: "success", started: 1, finished: 2 }],
  };
}
const raw = JSON.stringify({
  version: 1,
  pipeline: "123",
  commit: options.head,
  workflow: "verify",
  startedAt: 1000,
  finishedAt: 1001,
  exitCode: 0,
  collectionFailed: false,
  benchmarkResources: {
    version: 1,
    variant: "candidate",
    intervalMs: 10_000,
    collectionFailed: false,
    samples: [1000, 1002].map((at) => ({
      at,
      memory: {
        currentBytes: 100,
        peakBytes: 200,
        limitBytes: 36 * 1024 ** 3,
        limitHits: 0,
        oomEvents: 0,
        oomKills: 0,
      },
      filesystems: ["/woodpecker/tmp", "/woodpecker/gradle"].map(
        (path, index) => ({
          path,
          filesystem: "tmpfs",
          capacityBytes: (index === 0 ? 8 : 4) * 1024 ** 3,
          usedBytes: 100,
          availableBytes: 200,
        }),
      ),
    })),
  },
  turbo: [{ execution: { success: 1, failed: 0, cached: 0, attempted: 1 } }],
  environment: { TOKEN: "private-value" },
});
let archiveBody = "";
function body(text: string) {
  return { Body: { transformToWebStream: () => new Blob([text]).stream() } };
}
beforeEach(() => {
  vi.resetAllMocks();
  archiveBody = "";
  mocks.pipeline.mockResolvedValue(pipeline());
  mocks.client.mockReturnValue({ send: mocks.send, destroy: mocks.destroy });
  mocks.send.mockImplementation((command: unknown) => {
    if (command instanceof PutObjectCommand) {
      if (typeof command.input.Body !== "string")
        throw new TypeError("Expected string evidence");
      archiveBody = command.input.Body;
      return Promise.resolve({});
    }
    if (!(command instanceof GetObjectCommand))
      throw new TypeError("Unexpected S3 request");
    return Promise.resolve(
      body(
        command.input.Key?.endsWith("diagnostics-verify.json") === true
          ? raw
          : archiveBody,
      ),
    );
  });
});

test("read-only recovery forwards the profile, checks native state twice and never writes", async () => {
  const report = await inspectBenchmark(123, options, config);
  expect(report.taskSuccess).toBe(true);
  expect(report.archive).toBeNull();
  expect(mocks.client).toHaveBeenCalledWith("explicit-profile");
  expect(mocks.pipeline).toHaveBeenCalledTimes(2);
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

test("archive names the sanitized bytes by content hash and verifies actual readback", async () => {
  const report = await inspectBenchmark(
    123,
    { ...options, archive: true },
    config,
  );
  const digest = createHash("sha256").update(archiveBody).digest("hex");
  expect(report.archive).toBe(
    `s3://ci-handoff/123/qualification-resources-${digest}.json`,
  );
  expect(archiveBody).not.toContain("private-value");
  expect(archiveBody).not.toContain("private-token");
  expect(mocks.send).toHaveBeenCalledTimes(3);
});

test("a changed native attempt prevents an archive write", async () => {
  mocks.pipeline
    .mockResolvedValueOnce(pipeline())
    .mockResolvedValueOnce({ ...pipeline(), rerun_count: 1 });
  await expect(
    inspectBenchmark(123, { ...options, archive: true }, config),
  ).rejects.toThrow("state changed");
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

test("archive readback corruption fails rather than claiming retention", async () => {
  mocks.send
    .mockResolvedValueOnce(body(raw))
    .mockResolvedValueOnce({})
    .mockResolvedValueOnce(body("{}"));
  await expect(
    inspectBenchmark(123, { ...options, archive: true }, config),
  ).rejects.toThrow("readback differs");
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

test("oversized declared bodies are canceled before consumption", async () => {
  const cancel = vi.fn().mockResolvedValue(undefined);
  mocks.send.mockResolvedValueOnce({
    ContentLength: 129 * 1024 ** 2,
    Body: { transformToWebStream: () => ({ cancel }) },
  });
  await expect(inspectBenchmark(123, options, config)).rejects.toThrow(
    "128 MiB",
  );
  expect(cancel).toHaveBeenCalledOnce();
  expect(mocks.destroy).toHaveBeenCalledOnce();
});

test("custom Woodpecker connections cannot be joined to homelab artifacts", async () => {
  await expect(
    inspectBenchmark(123, options, { ...config, repoId: 2 }),
  ).rejects.toThrow("homelab monorepo");
  expect(mocks.pipeline).not.toHaveBeenCalled();
  expect(mocks.client).not.toHaveBeenCalled();
});
