import { afterEach, describe, expect, test } from "bun:test";
import {
  collectCiIoObservability,
  evaluateCiIoObservability,
} from "./ci-io-observability.ts";
import {
  countCiIoFinishedBuilds,
  selectCiIoCandidateBuilds,
} from "./ci-io-impact.ts";

const originalFetch = globalThis.fetch;
const originalPrometheusUrl = Bun.env["PROMETHEUS_URL"];
const originalGrafanaUrl = Bun.env["GRAFANA_URL"];
const originalGrafanaApiKey = Bun.env["GRAFANA_API_KEY"];

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPrometheusUrl === undefined) {
    delete Bun.env["PROMETHEUS_URL"];
  } else {
    Bun.env["PROMETHEUS_URL"] = originalPrometheusUrl;
  }
  if (originalGrafanaUrl === undefined) {
    delete Bun.env["GRAFANA_URL"];
  } else {
    Bun.env["GRAFANA_URL"] = originalGrafanaUrl;
  }
  if (originalGrafanaApiKey === undefined) {
    delete Bun.env["GRAFANA_API_KEY"];
  } else {
    Bun.env["GRAFANA_API_KEY"] = originalGrafanaApiKey;
  }
});

describe("CI I/O observability evidence", () => {
  test("selects the newest completed fixed-corpus build and excludes cancellations", () => {
    expect(
      selectCiIoCandidateBuilds([
        {
          number: 103,
          state: "canceled",
          env: { CI_IO_FIXED_CORPUS: "true" },
        },
        {
          number: 102,
          state: "failed",
          env: { CI_IO_FIXED_CORPUS: "true" },
        },
        {
          number: 101,
          state: "passed",
          env: { CI_IO_FIXED_CORPUS: "false" },
        },
      ]),
    ).toEqual([102]);
  });

  test("counts only passed and failed builds toward retirement", () => {
    expect(
      countCiIoFinishedBuilds([
        { state: "passed" },
        { state: "failed" },
        { state: "running" },
        { state: "blocked" },
        { state: "canceled" },
      ]),
    ).toBe(2);
  });

  test("enforces series, minimum, and maximum thresholds", () => {
    const definition = {
      id: "threshold",
      query: "metric",
      minimumRequiredSeries: 1,
      minimumValue: 1,
      maximumValue: 5,
    };
    expect(evaluateCiIoObservability(definition, [1, 5], 2)).toBe(true);
    expect(evaluateCiIoObservability(definition, [], 0)).toBe(false);
    expect(evaluateCiIoObservability(definition, [0], 1)).toBe(false);
    expect(evaluateCiIoObservability(definition, [6], 1)).toBe(false);
  });

  test("fails loudly when observability APIs are unavailable", async () => {
    Bun.env["PROMETHEUS_URL"] = "https://prometheus.example.test";
    Bun.env["GRAFANA_URL"] = "https://grafana.example.test";
    Bun.env["GRAFANA_API_KEY"] = "test-token";
    globalThis.fetch = Object.assign(
      async () => new Response("unavailable", { status: 503 }),
      { preconnect: originalFetch.preconnect },
    );

    await expect(collectCiIoObservability()).rejects.toThrow(/HTTP 503/);
  });
});
