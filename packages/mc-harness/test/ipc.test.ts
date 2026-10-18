import { describe, expect, it } from "vitest";
import { publishedStorm } from "#test/fixtures/published-storm.ts";
import {
  parseBlockPos,
  SandboxCreateRequestSchema,
  SandboxSummarySchema,
} from "#protocol/ipc.ts";

describe("ipc helpers", () => {
  it("binds future published images to their exact original source configuration without a Git pin", () => {
    const input = publishedStorm();
    expect(input.publishedArtifact?.digest).toBe(`sha256:${"c".repeat(64)}`);
    expect(
      SandboxCreateRequestSchema.safeParse({
        ...input,
        publishedArtifact: undefined,
      }).success,
    ).toBe(false);
    expect(
      SandboxCreateRequestSchema.safeParse({
        ...input,
        publishedConfig: {
          ...input.publishedConfig,
          sourceRevision: "d".repeat(40),
        },
      }).success,
    ).toBe(false);
    expect(
      SandboxCreateRequestSchema.safeParse({
        ...input,
        publishedConfig: { ...input.publishedConfig, yaml: "modules: {}" },
      }).success,
    ).toBe(false);
    expect(
      SandboxCreateRequestSchema.safeParse({ ...input, profile: "paper" })
        .success,
    ).toBe(false);
  });
  it("parses block positions", () => {
    expect(parseBlockPos("1,-60,3")).toEqual({ x: 1, y: -60, z: 3 });
    expect(() => parseBlockPos("1,2")).toThrow(/x,y,z/u);
    expect(() => parseBlockPos("1.5,2,3")).toThrow(/x,y,z/u);
  });

  it("bounds sandbox TTLs", () => {
    expect(
      SandboxCreateRequestSchema.safeParse({
        profile: "paper",
        world: "flat",
        ttlSeconds: 10,
        keep: false,
      }).success,
    ).toBe(false);
  });

  it("never lets a summary carry secrets", () => {
    const summary = {
      id: "sbx-abc123",
      provider: "docker",
      profile: "paper",
      world: "flat",
      status: "ready",
      createdAt: "x",
      expiresAt: "y",
      keep: false,
      bootMs: 1,
      endpoints: {
        game: { host: "127.0.0.1", port: 1 },
        rcon: { host: "127.0.0.1", port: 2 },
        bridge: { host: "127.0.0.1", port: 3 },
      },
    };
    expect(SandboxSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      SandboxSummarySchema.safeParse({
        ...summary,
        secrets: { bridgeToken: "t" },
      }).success,
    ).toBe(false);
  });
});
