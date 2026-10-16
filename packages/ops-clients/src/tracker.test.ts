import { expect, test } from "vitest";
import { TrackerClient } from "./tracker.ts";
import { sequence } from "./test-support/fake-fetch.ts";

const issue = (identifier: string, team: string, type: string) => ({
  id: identifier,
  identifier,
  title: identifier,
  createdAt: "2026-09-24T00:00:00Z",
  team: { key: team },
  state: { type },
});
const page = (items: unknown[], nextCursor: string | null) => ({
  result: { data: { items, nextCursor } },
});

test("Tracker paginates all open issues without credentials or cycles", async () => {
  const { fetch, requests } = sequence(
    page([issue("SJ-1", "SJ", "triage")], "next"),
    page([issue("AI-1", "AI", "started")], null),
  );
  const overview = await new TrackerClient({
    baseUrl: "https://tracker.example",
    fetch,
  }).overview();
  expect(overview.counts).toEqual({ SJ: { triage: 1 }, AI: { started: 1 } });
  expect(overview.triage.map((item) => item.identifier)).toEqual(["SJ-1"]);
  expect(overview.open[0]?.url).toBe("https://tracker.example/issues/SJ-1");
  expect(requests).toHaveLength(2);
  expect(
    requests.every((request) => request.headers.get("authorization") === null),
  ).toBe(true);
  const input = JSON.parse(
    new URL(requests[1]!.url).searchParams.get("input")!,
  );
  expect(input.cursor).toBe("next");
  expect(input.states).toEqual(["triage", "backlog", "unstarted", "started"]);
});

test("Tracker rejects unknown states and repeated cursors", async () => {
  const invalid = sequence(page([issue("AI-1", "AI", "someday")], null));
  await expect(
    new TrackerClient({
      baseUrl: "https://tracker.example",
      fetch: invalid.fetch,
    }).overview(),
  ).rejects.toThrow("schema");
  const repeated = sequence(page([], "next"), page([], "next"));
  await expect(
    new TrackerClient({
      baseUrl: "https://tracker.example",
      fetch: repeated.fetch,
    }).overview(),
  ).rejects.toThrow("repeated issue cursor");
});
