import { describe, expect, it } from "vitest";
import { TemporalReplayNamespaceSchema } from "./temporal-replay.ts";

describe("Temporal replay namespace", () => {
  it.each(["dev", "beta", "prod"])("accepts %s", (namespace) => {
    expect(TemporalReplayNamespaceSchema.parse(namespace)).toBe(namespace);
  });

  it.each([undefined, "", "default", "staging"])("rejects %s", (namespace) => {
    expect(() => TemporalReplayNamespaceSchema.parse(namespace)).toThrow();
  });
});
