import { describe, expect, test } from "vitest";
import {
  ArtifactDescriptorSchema,
  artifactDescriptorCodec,
} from "#src/artifacts/descriptors.ts";

const validDescriptorInput = {
  kind: "match",
  key: "games/2025/10/16/NA1_1234567890/match.json",
  digest: "a".repeat(64),
  bytes: 2048,
  contentType: "application/json",
  capturedAt: "2025-10-16T12:00:00Z",
};

describe("ArtifactDescriptorSchema", () => {
  test("parses a valid descriptor for every artifact kind", () => {
    for (const kind of ["match", "timeline", "prematch"]) {
      const parsed = ArtifactDescriptorSchema.parse({
        ...validDescriptorInput,
        kind,
      });
      expect(parsed.kind).toBe(kind);
    }
  });

  test("accepts a zero-byte artifact", () => {
    expect(
      ArtifactDescriptorSchema.parse({ ...validDescriptorInput, bytes: 0 })
        .bytes,
    ).toBe(0);
  });

  test("rejects an unknown artifact kind", () => {
    expect(() =>
      ArtifactDescriptorSchema.parse({
        ...validDescriptorInput,
        kind: "report",
      }),
    ).toThrow();
  });

  test("rejects extra keys", () => {
    expect(() =>
      ArtifactDescriptorSchema.parse({
        ...validDescriptorInput,
        etag: "abc123",
      }),
    ).toThrow();
  });

  test.each([
    { bytes: -1, reason: "negative" },
    { bytes: 1.5, reason: "non-integer" },
  ])("rejects $reason bytes", ({ bytes }) => {
    expect(() =>
      ArtifactDescriptorSchema.parse({ ...validDescriptorInput, bytes }),
    ).toThrow();
  });

  test("rejects an empty content type", () => {
    expect(() =>
      ArtifactDescriptorSchema.parse({
        ...validDescriptorInput,
        contentType: "",
      }),
    ).toThrow();
  });

  test.each([
    { digest: "a".repeat(63), reason: "too short" },
    { digest: "a".repeat(65), reason: "too long" },
    { digest: "A".repeat(64), reason: "uppercase hex" },
    { digest: "g".repeat(64), reason: "non-hex characters" },
  ])("rejects a digest that is $reason", ({ digest }) => {
    expect(() =>
      ArtifactDescriptorSchema.parse({ ...validDescriptorInput, digest }),
    ).toThrow();
  });
});

describe("artifactDescriptorCodec", () => {
  test("round-trips a descriptor through the versioned envelope", () => {
    const descriptor = ArtifactDescriptorSchema.parse(validDescriptorInput);
    const envelope = artifactDescriptorCodec.serialize(descriptor);
    expect(envelope.kind).toBe("artifact-descriptor");
    expect(envelope.version).toBe(1);
    expect(artifactDescriptorCodec.parse(envelope)).toEqual(descriptor);
  });

  test("rejects an unknown envelope version", () => {
    const descriptor = ArtifactDescriptorSchema.parse(validDescriptorInput);
    const envelope = artifactDescriptorCodec.serialize(descriptor);
    expect(() =>
      artifactDescriptorCodec.parse({ ...envelope, version: 2 }),
    ).toThrow(/unknown artifact-descriptor envelope version 2/);
  });

  test("rejects an unknown envelope kind", () => {
    const descriptor = ArtifactDescriptorSchema.parse(validDescriptorInput);
    const envelope = artifactDescriptorCodec.serialize(descriptor);
    expect(() =>
      artifactDescriptorCodec.parse({ ...envelope, kind: "descriptor" }),
    ).toThrow();
  });
});
