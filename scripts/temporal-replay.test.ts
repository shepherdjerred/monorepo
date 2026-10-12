import { describe, expect, it } from "vitest";
import {
  TemporalReplayNamespaceSchema,
  temporalOperatorConnectionOptions,
} from "./temporal-replay.ts";

describe("Temporal replay namespace", () => {
  it.each(["dev", "beta", "prod"])("accepts %s", (namespace) => {
    expect(TemporalReplayNamespaceSchema.parse(namespace)).toBe(namespace);
  });

  it.each([undefined, "", "default", "staging"])("rejects %s", (namespace) => {
    expect(() => TemporalReplayNamespaceSchema.parse(namespace)).toThrow();
  });
});

describe("Temporal replay connection", () => {
  it("uses the configured internal endpoint without a credential", () => {
    expect(
      temporalOperatorConnectionOptions({
        TEMPORAL_ADDRESS: "temporal.example:7233",
      }),
    ).toEqual({ address: "temporal.example:7233" });
  });

  it("passes the external API credential to the SDK over TLS", () => {
    expect(
      temporalOperatorConnectionOptions({
        TEMPORAL_ADDRESS: "temporal.example:443",
        TEMPORAL_TLS: "true",
        TEMPORAL_API_KEY: "test-only",
      }),
    ).toEqual({
      address: "temporal.example:443",
      tls: true,
      apiKey: "test-only",
    });
  });

  it.each([undefined, "false"])(
    "rejects credentials without TLS (%s)",
    (tls) => {
      expect(() =>
        temporalOperatorConnectionOptions({
          TEMPORAL_ADDRESS: "temporal.example:443",
          TEMPORAL_TLS: tls,
          TEMPORAL_API_KEY: "test-only",
        }),
      ).toThrow("requires TEMPORAL_TLS=true");
    },
  );

  it("rejects empty credentials and ambiguous TLS", () => {
    expect(() =>
      temporalOperatorConnectionOptions({
        TEMPORAL_ADDRESS: "temporal.example:443",
        TEMPORAL_TLS: "true",
        TEMPORAL_API_KEY: "",
      }),
    ).toThrow("nonempty TEMPORAL_API_KEY");
    expect(() =>
      temporalOperatorConnectionOptions({
        TEMPORAL_ADDRESS: "temporal.example:443",
        TEMPORAL_TLS: "yes",
      }),
    ).toThrow();
  });

  it.each([undefined, ""])(
    "requires an explicit nonempty address (%s)",
    (address) => {
      expect(() =>
        temporalOperatorConnectionOptions({ TEMPORAL_ADDRESS: address }),
      ).toThrow("TEMPORAL_ADDRESS is required");
    },
  );
});
