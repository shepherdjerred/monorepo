import { expect, test } from "bun:test";
import {
  BUILD_METADATA_LIMIT_BYTES,
  INLINE_HANDOFF_LIMIT_BYTES,
  handoffValue,
  writeJsonHandoff,
} from "./buildkite-handoff.ts";
import {
  artifactNameFromMetadata,
  readHandoffValue,
  requiredArgument,
} from "./read-buildkite-handoff.ts";

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
  );
  expect(result.useArtifact).toBe(true);
  expect(result.metadata).toBe("artifact:handoff.json");
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
  expect(() => artifactNameFromMetadata("artifact:handoff.txt")).toThrow(
    "invalid Buildkite handoff artifact pointer",
  );
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
  await expect(
    readHandoffValue("artifact:handoff.json", "images", async () => 1),
  ).rejects.toThrow(
    "could not download Buildkite handoff artifact handoff.json",
  );
});

test("writes small handoffs directly to metadata", async () => {
  const calls: string[][] = [];
  await writeJsonHandoff(
    "handoff-key",
    "handoff.json",
    { value: "small" },
    (args) => {
      calls.push([...args]);
      return Promise.resolve(0);
    },
  );
  expect(calls).toEqual([
    ["meta-data", "set", "handoff-key", '{"value":"small"}'],
  ]);
});

test("uploads large handoffs before publishing the artifact pointer", async () => {
  const artifactName = "buildkite-handoff-test.json";
  const calls: string[][] = [];
  try {
    await writeJsonHandoff(
      "handoff-key",
      artifactName,
      { value: "x".repeat(INLINE_HANDOFF_LIMIT_BYTES) },
      (args) => {
        calls.push([...args]);
        return Promise.resolve(0);
      },
    );
    expect(await Bun.file(artifactName).json()).toEqual({
      value: "x".repeat(INLINE_HANDOFF_LIMIT_BYTES),
    });
    expect(calls).toEqual([
      ["artifact", "upload", artifactName],
      ["meta-data", "set", "handoff-key", `artifact:${artifactName}`],
    ]);
  } finally {
    await Bun.file(artifactName).delete();
  }
});

test("fails when artifact upload or metadata publication fails", async () => {
  const artifactName = "buildkite-handoff-failure-test.json";
  try {
    await expect(
      writeJsonHandoff(
        "handoff-key",
        artifactName,
        { value: "x".repeat(INLINE_HANDOFF_LIMIT_BYTES) },
        () => Promise.resolve(1),
      ),
    ).rejects.toThrow(
      `could not upload Buildkite handoff artifact ${artifactName}`,
    );
  } finally {
    await Bun.file(artifactName).delete();
  }
  await expect(
    writeJsonHandoff("handoff-key", "handoff.json", { value: "small" }, () =>
      Promise.resolve(1),
    ),
  ).rejects.toThrow("could not set Buildkite handoff metadata handoff-key");
});

test("reads inline and downloaded handoff values", async () => {
  expect(await readHandoffValue('{"value":"small"}', "images")).toBe(
    '{"value":"small"}\n',
  );
  const artifactName = "read-buildkite-handoff-test.json";
  await Bun.write(artifactName, '{"value":"large"}\n');
  try {
    const calls: string[][] = [];
    expect(
      await readHandoffValue(
        `artifact:${artifactName}`,
        "images",
        (name, step) => {
          calls.push([name, step]);
          return Promise.resolve(0);
        },
      ),
    ).toBe('{"value":"large"}\n');
    expect(calls).toEqual([[artifactName, "images"]]);
  } finally {
    await Bun.file(artifactName).delete();
  }
});
