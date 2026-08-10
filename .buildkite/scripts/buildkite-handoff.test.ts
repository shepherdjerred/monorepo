import { expect, test } from "bun:test";
import {
  BUILD_METADATA_LIMIT_BYTES,
  INLINE_HANDOFF_LIMIT_BYTES,
  handoffValue,
  writeJsonHandoff,
} from "./buildkite-handoff.ts";
import {
  artifactPointerFromMetadata,
  readHandoffValue,
  requiredArgument,
} from "./read-buildkite-handoff.ts";

const PRODUCING_JOB_ID = "019fe9ea-3609-4e54-9e79-8ea6bd6aeba2";
const RETRY_JOB_ID = "019fe9ea-3610-4e54-9e79-8ea6bd6aeba2";

function scopedArtifactName(name: string, jobId: string): string {
  return `${name.slice(0, -".json".length)}.${jobId}.json`;
}

test("keeps the exact one KiB boundary in metadata", () => {
  const result = handoffValue(
    "x".repeat(INLINE_HANDOFF_LIMIT_BYTES - 3),
    "handoff.json",
  );
  expect(result.useArtifact).toBe(false);
  expect(new TextEncoder().encode(result.serialized).byteLength).toBe(
    INLINE_HANDOFF_LIMIT_BYTES,
  );
});

test("keeps small JSON handoffs in Buildkite metadata", () => {
  const result = handoffValue({ value: "small" }, "handoff.json");
  expect(result.useArtifact).toBe(false);
  expect(result.metadata).toBe('{"value":"small"}');
});

test("uses an artifact pointer for payloads over one KiB", () => {
  const result = handoffValue(
    { value: "x".repeat(INLINE_HANDOFF_LIMIT_BYTES) },
    "handoff.json",
    PRODUCING_JOB_ID,
  );
  expect(result.useArtifact).toBe(true);
  expect(result.artifactName).toBe(
    scopedArtifactName("handoff.json", PRODUCING_JOB_ID),
  );
  expect(result.metadata).toBe(
    `artifact:${PRODUCING_JOB_ID}:${result.artifactName}`,
  );
  expect(
    handoffValue(
      { value: "x".repeat(INLINE_HANDOFF_LIMIT_BYTES) },
      "handoff.json",
      RETRY_JOB_ID,
    ).artifactName,
  ).not.toBe(result.artifactName);
});

test("rejects an invalid artifact name", () => {
  expect(() => handoffValue({ value: "large" }, "handoff.txt")).toThrow(
    "invalid Buildkite handoff artifact name",
  );
});

test("exposes the Buildkite metadata size contract", () => {
  expect(BUILD_METADATA_LIMIT_BYTES).toBe(100 * 1024);
});

test("rejects malformed artifact pointers", () => {
  expect(() => artifactPointerFromMetadata("artifact:handoff.txt")).toThrow(
    "invalid Buildkite handoff artifact pointer",
  );
  expect(() =>
    artifactPointerFromMetadata(
      `artifact:${PRODUCING_JOB_ID}:handoff.${RETRY_JOB_ID}.json`,
    ),
  ).toThrow("invalid Buildkite handoff artifact pointer");
  expect(() =>
    handoffValue(
      { value: "x".repeat(INLINE_HANDOFF_LIMIT_BYTES) },
      "handoff.json",
      "not-a-job-id",
    ),
  ).toThrow("BUILDKITE_JOB_ID must be a valid UUID");
});

test("requires nonempty CLI arguments", () => {
  expect(requiredArgument(["bun", "script", "key"], 2, "metadata key")).toBe(
    "key",
  );
  expect(() => requiredArgument(["bun", "script"], 2, "metadata key")).toThrow(
    "metadata key is required",
  );
  expect(() =>
    requiredArgument(["bun", "script", ""], 2, "metadata key"),
  ).toThrow("metadata key is required");
});

test("reports missing handoff artifacts", async () => {
  const artifactName = scopedArtifactName("handoff.json", PRODUCING_JOB_ID);
  await expect(
    readHandoffValue(
      `artifact:${PRODUCING_JOB_ID}:${artifactName}`,
      async () => 1,
    ),
  ).rejects.toThrow(
    `could not download Buildkite handoff artifact ${artifactName}`,
  );
});

test("writes small handoffs directly to metadata", async () => {
  const calls: string[][] = [];
  await writeJsonHandoff(
    "handoff-key",
    "handoff.json",
    { value: "small" },
    {
      runner: (args) => {
        calls.push([...args]);
        return Promise.resolve(0);
      },
    },
  );
  expect(calls).toEqual([
    ["meta-data", "set", "handoff-key", '{"value":"small"}'],
  ]);
});

test("uploads large handoffs before publishing the artifact pointer", async () => {
  const baseArtifactName = "buildkite-handoff-test.json";
  const artifactName = scopedArtifactName(baseArtifactName, PRODUCING_JOB_ID);
  const calls: string[][] = [];
  try {
    await writeJsonHandoff(
      "handoff-key",
      baseArtifactName,
      { value: "x".repeat(INLINE_HANDOFF_LIMIT_BYTES) },
      {
        producingJobId: PRODUCING_JOB_ID,
        runner: (args) => {
          calls.push([...args]);
          return Promise.resolve(0);
        },
      },
    );
    expect(await Bun.file(artifactName).json()).toEqual({
      value: "x".repeat(INLINE_HANDOFF_LIMIT_BYTES),
    });
    expect(calls).toEqual([
      ["artifact", "upload", artifactName],
      [
        "meta-data",
        "set",
        "handoff-key",
        `artifact:${PRODUCING_JOB_ID}:${artifactName}`,
      ],
    ]);
  } finally {
    await Bun.file(artifactName).delete();
  }
});

test("fails when artifact upload or metadata publication fails", async () => {
  const baseArtifactName = "buildkite-handoff-failure-test.json";
  const artifactName = scopedArtifactName(baseArtifactName, PRODUCING_JOB_ID);
  try {
    await expect(
      writeJsonHandoff(
        "handoff-key",
        baseArtifactName,
        { value: "x".repeat(INLINE_HANDOFF_LIMIT_BYTES) },
        {
          producingJobId: PRODUCING_JOB_ID,
          runner: () => Promise.resolve(1),
        },
      ),
    ).rejects.toThrow(
      `could not upload Buildkite handoff artifact ${artifactName}`,
    );
  } finally {
    await Bun.file(artifactName).delete();
  }
  await expect(
    writeJsonHandoff(
      "handoff-key",
      "handoff.json",
      { value: "small" },
      {
        runner: () => Promise.resolve(1),
      },
    ),
  ).rejects.toThrow("could not set Buildkite handoff metadata handoff-key");
});

test("reads inline and downloaded handoff values", async () => {
  expect(await readHandoffValue('{"value":"small"}')).toBe(
    '{"value":"small"}\n',
  );
  const artifactName = scopedArtifactName(
    "read-buildkite-handoff-test.json",
    PRODUCING_JOB_ID,
  );
  await Bun.write(artifactName, '{"value":"large"}\n');
  try {
    const calls: string[][] = [];
    expect(
      await readHandoffValue(
        `artifact:${PRODUCING_JOB_ID}:${artifactName}`,
        (name, jobId) => {
          calls.push([name, jobId]);
          return Promise.resolve(0);
        },
      ),
    ).toBe('{"value":"large"}\n');
    expect(calls).toEqual([[artifactName, PRODUCING_JOB_ID]]);
  } finally {
    await Bun.file(artifactName).delete();
  }
});
