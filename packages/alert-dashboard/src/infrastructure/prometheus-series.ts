import { Temporal } from "@js-temporal/polyfill";
import { PrometheusClient } from "@shepherdjerred/ops-clients/prometheus.ts";

import { UpstreamUnavailableError } from "#application/ops-errors";
import type { SeriesPort, SeriesRangeRequest } from "#application/ports";
import { toContractDate } from "#shared/time";

function toSeconds(seconds: number): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(seconds * 1000);
}

/**
 * Prometheus behind the series port. Every failure — HTTP, timeout, schema
 * mismatch — surfaces as `UpstreamUnavailableError` with a body-free message,
 * so routes can answer with a typed 502 instead of leaking upstream detail.
 */
export class PrometheusSeries implements SeriesPort {
  readonly #client: PrometheusClient;

  constructor(baseUrl: string) {
    this.#client = new PrometheusClient({ baseUrl });
  }

  async range(request: SeriesRangeRequest) {
    try {
      return await this.#client.range({
        query: request.promql,
        start: toContractDate(toSeconds(request.startSeconds)),
        end: toContractDate(toSeconds(request.endSeconds)),
        stepSeconds: request.stepSeconds,
      });
    } catch (error) {
      throw unavailable(error);
    }
  }

  async scalar(promql: string): Promise<number | null> {
    try {
      return await this.#client.scalar(promql);
    } catch (error) {
      throw unavailable(error);
    }
  }
}

function unavailable(error: unknown): UpstreamUnavailableError {
  const message =
    error instanceof Error ? error.message.slice(0, 300) : "request failed";
  return new UpstreamUnavailableError("prometheus", message);
}
