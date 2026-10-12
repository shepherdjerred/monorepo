import { describe, expect, test } from "vitest";
import { temporalConnectionOptions } from "./temporal-connection.ts";

describe("temporalConnectionOptions", () => {
  test("uses the in-cluster default without TLS", () => {
    expect(
      temporalConnectionOptions({
        environment: {},
        defaultAddress: "temporal.example:7233",
      }),
    ).toEqual({ address: "temporal.example:7233" });
  });

  test("enables TLS for an explicitly configured ingress", () => {
    expect(
      temporalConnectionOptions({
        environment: {
          TEMPORAL_ADDRESS: "temporal.tailnet.example:443",
          TEMPORAL_TLS: "true",
        },
        defaultAddress: "temporal.example:7233",
      }),
    ).toEqual({
      address: "temporal.tailnet.example:443",
      tls: true,
    });
  });

  test("rejects an ambiguous TLS value", () => {
    expect(() =>
      temporalConnectionOptions({
        environment: { TEMPORAL_TLS: "yes" },
        defaultAddress: "temporal.example:7233",
      }),
    ).toThrow();
  });

  test("passes the external API credential to the SDK over TLS", () => {
    expect(
      temporalConnectionOptions({
        environment: { TEMPORAL_TLS: "true", TEMPORAL_API_KEY: "test-only" },
        defaultAddress: "temporal.example:443",
      }),
    ).toEqual({
      address: "temporal.example:443",
      tls: true,
      apiKey: "test-only",
    });
  });

  test.each([undefined, "false"])(
    "rejects credentials without TLS (%s)",
    (tls) => {
      expect(() =>
        temporalConnectionOptions({
          environment: { TEMPORAL_TLS: tls, TEMPORAL_API_KEY: "test-only" },
          defaultAddress: "temporal.example:443",
        }),
      ).toThrow("requires TEMPORAL_TLS=true");
    },
  );

  test("rejects an empty credential", () => {
    expect(() =>
      temporalConnectionOptions({
        environment: { TEMPORAL_TLS: "true", TEMPORAL_API_KEY: "" },
        defaultAddress: "temporal.example:443",
      }),
    ).toThrow("nonempty TEMPORAL_API_KEY");
  });
});
