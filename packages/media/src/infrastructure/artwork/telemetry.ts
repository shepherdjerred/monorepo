/** One structured log line; the server entry point decides where it goes. */
export type ArtworkLog = (entry: Record<string, string | number>) => void;

type RequestOutcome = "hit" | "miss" | "not_found" | "unavailable" | "error";

function counter(
  name: string,
  label: string,
  values: ReadonlyMap<string, number>,
): string {
  return [
    `# TYPE ${name} counter`,
    ...[...values].map(
      ([value, count]) => `${name}{${label}="${value}"} ${String(count)}`,
    ),
    "",
  ].join("\n");
}

function scalar(name: string, type: "counter" | "gauge", value: number) {
  return `# TYPE ${name} ${type}\n${name} ${String(value)}\n`;
}

/**
 * In-process counters and log lines for the artwork proxy. Labels are closed
 * sets: an image width or file name never becomes a label.
 */
export class ArtworkTelemetry {
  private readonly requests = new Map<string, number>(
    ["hit", "miss", "not_found", "unavailable", "error"].map((outcome) => [
      outcome,
      0,
    ]),
  );
  private readonly upstream = new Map<string, number>(
    ["found", "missing", "unavailable", "rate-limited", "invalid-response"].map(
      (outcome) => [outcome, 0],
    ),
  );
  private corruptEntries = 0;
  private evictedEntries = 0;
  private evictedBytes = 0;

  constructor(private readonly log: ArtworkLog) {}

  request(outcome: RequestOutcome): void {
    this.requests.set(outcome, (this.requests.get(outcome) ?? 0) + 1);
  }

  /** `found`, `missing`, or the integration failure kind. */
  upstreamOutcome(outcome: string): void {
    this.upstream.set(outcome, (this.upstream.get(outcome) ?? 0) + 1);
  }

  upstreamFailed(key: string, kind: string, status: number | undefined): void {
    this.upstreamOutcome(kind);
    this.log({
      event: "media_artwork_upstream_failed",
      key,
      kind,
      ...(status === undefined ? {} : { status }),
    });
  }

  saturated(key: string): void {
    this.log({ event: "media_artwork_upstream_saturated", key });
  }

  corrupt(key: string, reason: "missing" | "empty" | "signature"): void {
    this.corruptEntries += 1;
    this.log({ event: "media_artwork_cache_corrupt", key, reason });
  }

  evicted(entries: number, bytes: number): void {
    this.evictedEntries += entries;
    this.evictedBytes += bytes;
    this.log({ event: "media_artwork_cache_evicted", entries, bytes });
  }

  /** Prometheus text. `stored` is absent until the cache has been scanned. */
  render(stored: { entries: number; bytes: number } | null): string {
    return (
      counter("media_artwork_requests_total", "outcome", this.requests) +
      counter("media_artwork_upstream_total", "outcome", this.upstream) +
      scalar(
        "media_artwork_cache_corrupt_total",
        "counter",
        this.corruptEntries,
      ) +
      scalar(
        "media_artwork_cache_evictions_total",
        "counter",
        this.evictedEntries,
      ) +
      scalar(
        "media_artwork_cache_evicted_bytes_total",
        "counter",
        this.evictedBytes,
      ) +
      (stored === null
        ? ""
        : scalar("media_artwork_cache_entries", "gauge", stored.entries) +
          scalar("media_artwork_cache_bytes", "gauge", stored.bytes))
    );
  }
}
