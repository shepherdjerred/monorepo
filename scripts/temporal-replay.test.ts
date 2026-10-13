import { describe, expect, it } from "vitest";
import {
  TemporalReplayNamespaceSchema,
  temporalOperatorConnectionOptions,
  parseTemporalReplayTargets,
} from "./temporal-replay.ts";

function validateBetaWorkflowId(value: string) {
  if (!value.startsWith("scout-beta-")) throw new Error("Wrong stage");
  return value;
}

describe("Temporal replay executions", () => {
  const first = "81811c56-c5cb-4401-a272-a6578512ede6";
  const second = "10c752e8-51af-47b7-aad5-17e64668f095";
  it("retains two exact runs of the same Workflow alongside a latest-run request", () => {
    expect(
      parseTemporalReplayTargets(
        [
          "--run",
          "scout-beta-dispatch",
          first,
          "--run",
          "scout-beta-dispatch",
          second,
          "scout-beta-match",
        ],
        validateBetaWorkflowId,
      ),
    ).toEqual([
      { workflowId: "scout-beta-dispatch", runId: first },
      { workflowId: "scout-beta-dispatch", runId: second },
      "scout-beta-match",
    ]);
  });
  it.each([
    { args: ["--run"] },
    { args: ["--run", "scout-beta-dispatch"] },
    { args: ["--run", "scout-beta-dispatch", "not-a-run"] },
    { args: ["--run", "scout-prod-dispatch", first] },
  ])(
    "rejects incomplete, invalid, or wrong-stage targets $args",
    ({ args }) => {
      expect(() =>
        parseTemporalReplayTargets(args, validateBetaWorkflowId),
      ).toThrow();
    },
  );
});

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
