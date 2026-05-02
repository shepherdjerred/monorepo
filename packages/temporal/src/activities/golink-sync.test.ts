import { afterEach, describe, expect, it } from "bun:test";
import { golinkSyncActivities } from "./golink-sync.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("golinkSyncActivities", () => {
  it("parses exported owner metadata for sync idempotency decisions", async () => {
    globalThis.fetch = Object.assign(
      async () =>
        new Response(
          [
            JSON.stringify({
              Short: "temporal",
              Long: "https://temporal-ui.tailnet-1a49.ts.net",
              Owner: "shepherdjerred@gmail.com",
            }),
            JSON.stringify({
              Short: "temporal-ui",
              Long: "https://temporal-ui.tailnet-1a49.ts.net/",
              Owner: "tagged-devices",
            }),
          ].join("\n"),
          { status: 200 },
        ),
      { preconnect: originalFetch.preconnect },
    );

    const entries =
      await golinkSyncActivities.getExistingGolinks("https://go.example");

    expect(entries).toEqual([
      {
        short: "temporal",
        long: "https://temporal-ui.tailnet-1a49.ts.net",
        owner: "shepherdjerred@gmail.com",
      },
      {
        short: "temporal-ui",
        long: "https://temporal-ui.tailnet-1a49.ts.net/",
        owner: "tagged-devices",
      },
    ]);
  });
});
