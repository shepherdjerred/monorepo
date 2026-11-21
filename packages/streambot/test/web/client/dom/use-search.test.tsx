// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useSearch } from "@shepherdjerred/streambot/web/client/search/use-search.ts";
import { RoomCapabilitiesSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  advance,
  mount,
  perform,
  stubFetch,
  type Call,
  type Mounted,
} from "./harness.ts";

/** Only the groups every viewer has: the library and videos. */
const BASIC = RoomCapabilitiesSchema.parse(
  Object.fromEntries(
    RoomCapabilitiesSchema.keyof().options.map((key) => [key, false]),
  ),
);

let latest: ReturnType<typeof useSearch> | null = null;

function Probe(props: { query: string }) {
  latest = useSearch(props.query, "10", BASIC);
  return null;
}

/** The titles each group shows, by group. */
function shownTitles() {
  if (latest === null) throw new Error("The probe did not render");
  return Object.fromEntries(
    Object.entries(latest.groups).map(([key, state]) => [
      key,
      state.status === "failed" ? [] : state.items.map((item) => item.title),
    ]),
  );
}

function rowsFor(query: string, kind: "library" | "videos") {
  return {
    kind,
    items: [
      {
        id: query + "-" + kind,
        kind: kind === "library" ? "library" : "video",
        title: query + " " + kind,
        actions: ["watch"],
      },
    ],
  };
}

/** Answers every request for `query` with that query's rows. */
async function answer(calls: readonly Call[], query: string) {
  await perform(() => {
    for (const call of calls) {
      const url = new URL(call.url, "https://streambot.test");
      const kind = url.searchParams.get("kind");
      if (url.searchParams.get("q") !== query) continue;
      if (kind === "library" || kind === "videos")
        call.answer(200, rowsFor(query, kind));
    }
  });
}

let view: Mounted;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(async () => {
  await view.unmount();
  latest = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function searchTwice() {
  view = await mount(<Probe query="alpha" />);
  await advance(250);
  await view.rerender(<Probe query="beta" />);
  await advance(250);
}

describe("useSearch", () => {
  test("an older query that answers last never replaces the newer rows", async () => {
    const calls = stubFetch({ ignoreAbort: true });
    await searchTwice();
    expect(calls).toHaveLength(4);

    await answer(calls, "beta");
    await answer(calls, "alpha");

    expect(latest?.settled).toBe("beta");
    expect(shownTitles()).toEqual({
      library: ["beta library"],
      videos: ["beta videos"],
    });
  });

  test("a newer query aborts every request of the older one", async () => {
    const calls = stubFetch();
    await searchTwice();
    const older = calls.filter((call) => call.url.includes("q=alpha"));
    expect(older).toHaveLength(2);
    expect(older.every((call) => call.init?.signal?.aborted === true)).toBe(
      true,
    );

    await answer(calls, "beta");
    expect(shownTitles()).toEqual({
      library: ["beta library"],
      videos: ["beta videos"],
    });
  });

  test("an older answer that lands while the newer query is still waiting is dropped", async () => {
    const calls = stubFetch({ ignoreAbort: true });
    view = await mount(<Probe query="alpha" />);
    await advance(250);
    await view.rerender(<Probe query="beta" />);
    await answer(calls, "alpha");

    expect(shownTitles()).toEqual({
      library: [],
      videos: [],
    });
  });
});
