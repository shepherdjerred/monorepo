import { describe, expect, test } from "vitest";
import type { TraceSummary } from "@shepherdjerred/ops-clients/tempo.ts";
import { ServiceIndex } from "@shepherdjerred/ops-model/catalog.ts";
import { SignalSchema } from "@shepherdjerred/ops-model/snapshot.ts";
import { mapTraces } from "./traces.ts";

const now = new Date("2026-09-25T19:00:00.000Z");
const context = { now, services: new ServiceIndex() };

function trace(
  traceId: string,
  rootServiceName: string | undefined,
  durationMs: number,
): TraceSummary {
  return {
    traceId,
    rootServiceName,
    rootTraceName: rootServiceName === undefined ? undefined : `${traceId}-op`,
    startedAt: new Date("2026-09-25T18:30:00.000Z"),
    durationMs,
  };
}

describe("mapTraces", () => {
  test("groups by root service, joins the catalog, and links to Tempo", () => {
    const result = mapTraces(
      {
        traces: [
          trace("a", "birmel", 300),
          trace("b", "birmel", 900),
          trace("c", "openrouter", 400),
        ],
        truncated: false,
      },
      { traces: [trace("d", "birmel", 7000)], truncated: false },
      context,
    );

    expect(
      result.signals.map((signal) => [
        signal.id,
        signal.kind,
        signal.service,
        signal.title,
        signal.attributes?.["slowestMs"],
        signal.attributes?.["exampleTraceId"],
      ]),
    ).toEqual([
      [
        "traces:error-traces:birmel",
        "error-traces",
        "birmel",
        "birmel: 2 error traces in 1h",
        900,
        "b",
      ],
      [
        "traces:error-traces:openrouter",
        "error-traces",
        undefined,
        "openrouter: 1 error trace in 1h",
        400,
        "c",
      ],
      [
        "traces:slow-traces:birmel",
        "slow-traces",
        "birmel",
        "birmel: 1 slow trace in 1h",
        7000,
        "d",
      ],
    ]);
    for (const signal of result.signals) {
      expect(signal.severity).toBe("info");
      expect(signal.needsMe).toBe(false);
      expect(() => SignalSchema.parse(signal)).not.toThrow();
    }
    const link = result.signals[0]?.links?.[0];
    expect(link?.kind).toBe("traces");
    const panes: unknown = JSON.parse(
      new URL(link?.url ?? "").searchParams.get("panes") ?? "null",
    );
    expect(panes).toMatchObject({
      ops: {
        datasource: "tempo",
        queries: [
          {
            queryType: "traceql",
            query: '{ resource.service.name = "birmel" && status = error }',
          },
        ],
      },
    });
    expect(result.metrics.map((m) => [m.id, m.value, m.label])).toEqual([
      ["traces.errors_1h", 3, "Error traces (1h)"],
      ["traces.slow_1h", 1, "Traces > 5s (1h)"],
    ]);
  });

  test("a full result page is reported as a lower bound", () => {
    const result = mapTraces(
      { traces: [trace("a", "birmel", 10)], truncated: true },
      { traces: [], truncated: false },
      context,
    );
    expect(result.signals[0]?.title).toBe("birmel: ≥1 error trace in 1h");
    expect(result.metrics[0]?.label).toBe("Error traces (1h, ≥)");
  });

  test("traces without a root span are grouped and not linked", () => {
    const result = mapTraces(
      { traces: [trace("a", undefined, 10)], truncated: false },
      { traces: [], truncated: false },
      context,
    );
    expect(result.signals[0]?.id).toBe("traces:error-traces:(no root span)");
    expect(result.signals[0]?.links).toEqual([]);
  });

  test("no traces yields zero metrics and no signals", () => {
    const empty = { traces: [], truncated: false };
    const result = mapTraces(empty, empty, context);
    expect(result.signals).toEqual([]);
    expect(result.metrics.map((m) => m.value)).toEqual([0, 0]);
  });
});
