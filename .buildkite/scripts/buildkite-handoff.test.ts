import { expect, test } from "bun:test";
import {
  BUILD_METADATA_LIMIT_BYTES,
  INLINE_HANDOFF_LIMIT_BYTES,
  handoffValue,
} from "./buildkite-handoff.ts";
import {
  artifactNameFromMetadata,
  readHandoffValue,
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

test("reports missing handoff artifacts", async () => {
  await expect(
    readHandoffValue("artifact:handoff.json", "images", async () => 1),
  ).rejects.toThrow(
    "could not download Buildkite handoff artifact handoff.json",
  );
});
