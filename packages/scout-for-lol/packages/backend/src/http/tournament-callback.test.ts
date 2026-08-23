import { describe, expect, test } from "vitest";
import { handleTournamentCallback } from "#src/http/tournament-callback.ts";

function post(body: string): Request {
  return new Request(
    "https://beta.scout-for-lol.com/api/riot/tournament-callback",
    {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("handleTournamentCallback", () => {
  test("acknowledges a well-formed callback", async () => {
    const response = await handleTournamentCallback(
      post(JSON.stringify({ shortCode: "NA1234a-abc", gameId: 42 })),
    );
    expect(response.status).toBe(200);
  });

  test("still answers 200 on an unparseable body", async () => {
    // Riot retries on anything but a 200, and there is nothing here to retry
    // into — the poller and the match-history cursor drive the lifecycle. The
    // failure is counted rather than hidden.
    const response = await handleTournamentCallback(post("not json"));
    expect(response.status).toBe(200);
  });

  test("rejects a non-POST", async () => {
    const response = await handleTournamentCallback(
      new Request(
        "https://beta.scout-for-lol.com/api/riot/tournament-callback",
      ),
    );
    expect(response.status).toBe(405);
  });

  test("mutates nothing — the body is read and discarded", async () => {
    // The endpoint is unauthenticated: tournament-v5 has no shared secret, so
    // the URL is the only credential. A handler that wrote anything would be an
    // injection path into the canonical S3 match store.
    const response = await handleTournamentCallback(
      post(JSON.stringify({ shortCode: "x", gameId: 1, metaData: "{}" })),
    );
    expect(await response.text()).toBe("ok");
  });
});
