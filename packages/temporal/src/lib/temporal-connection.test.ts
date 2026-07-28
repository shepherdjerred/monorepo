import { describe, expect, test } from "bun:test";
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
});
