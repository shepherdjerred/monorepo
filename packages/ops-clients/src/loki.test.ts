import { describe, expect, test } from "vitest";
import {
  errorVolumeQuery,
  LokiClient,
} from "@shepherdjerred/ops-clients/loki.ts";
import { sequence } from "@shepherdjerred/ops-clients/test-support/fake-fetch.ts";

describe("LokiClient", () => {
  test("returns error volume by namespace, largest first", async () => {
    const { fetch, requests } = sequence({
      status: "success",
      data: {
        resultType: "vector",
        result: [
          { metric: { namespace: "birmel" }, value: [1, "3"] },
          { metric: { namespace: "temporal" }, value: [1, "40"] },
        ],
      },
    });
    const client = new LokiClient({ baseUrl: "http://loki:3100", fetch });
    await expect(
      client.errorVolumeByNamespace("1h", new Date(1000)),
    ).resolves.toEqual([
      { namespace: "temporal", lines: 40 },
      { namespace: "birmel", lines: 3 },
    ]);
    const url = new URL(requests[0]?.url ?? "");
    expect(url.pathname).toBe("/loki/api/v1/query");
    expect(url.searchParams.get("query")).toBe(errorVolumeQuery("1h"));
    expect(url.searchParams.get("time")).toBe("1000000000");
  });

  test("an error status fails", async () => {
    const { fetch } = sequence({ status: "error", error: "parse error" });
    const client = new LokiClient({ baseUrl: "http://loki:3100", fetch });
    await expect(
      client.errorVolumeByNamespace("1h", new Date()),
    ).rejects.toThrow(/^loki: /);
  });
});
