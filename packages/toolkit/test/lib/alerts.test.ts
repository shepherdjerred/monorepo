import { afterEach, describe, expect, it } from "bun:test";

import { listAlerts } from "#lib/alerts.ts";

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_URL = Bun.env["ALERT_DASHBOARD_URL"];
type FetchInput = Parameters<typeof fetch>[0];

function fetchInputToUrl(input: FetchInput): URL {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

function alert(index: number) {
  return {
    id: `alert_${index.toString(16).padStart(32, "0")}`,
    fingerprint: `fingerprint-${String(index)}`,
    alertname: `Alert${String(index)}`,
    namespace: "test",
    severity: "warning",
    summary: "Pagination fixture",
    lifecycleState: "open",
    suppressionState: "none",
    resolutionSource: null,
    openedAt: "2026-08-08T18:00:00Z",
    resolvedAt: null,
    lastSeenAt: "2026-08-08T18:01:00Z",
    generatorUrl: null,
    labels: {},
    annotations: {},
  };
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_URL === undefined)
    Reflect.deleteProperty(Bun.env, "ALERT_DASHBOARD_URL");
  else Bun.env["ALERT_DASHBOARD_URL"] = ORIGINAL_URL;
});

describe("Alerts API pagination", () => {
  it("follows every cursor when the caller does not set a result limit", async () => {
    const requestedUrls: URL[] = [];
    const fetchMock: typeof fetch = Object.assign(
      async (input: FetchInput) => {
        const url = fetchInputToUrl(input);
        requestedUrls.push(url);
        const secondPage = url.searchParams.has("cursor");
        return Response.json({
          items: secondPage
            ? [alert(100)]
            : Array.from({ length: 100 }, (_, index) => alert(index)),
          nextCursor: secondPage ? null : alert(99).id,
        });
      },
      { preconnect: ORIGINAL_FETCH.preconnect },
    );
    globalThis.fetch = fetchMock;
    Bun.env["ALERT_DASHBOARD_URL"] = "https://alerts.example.test";

    const result = await listAlerts({ lifecycleState: "open" });

    expect(result).toHaveLength(101);
    expect(requestedUrls).toHaveLength(2);
    expect(requestedUrls[0]?.searchParams.get("limit")).toBe("100");
    expect(requestedUrls[1]?.searchParams.get("cursor")).toBe(alert(99).id);
  });
});
