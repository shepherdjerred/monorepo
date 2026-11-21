// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useRoom } from "@shepherdjerred/streambot/web/client/room/use-room.ts";
import { roomWith } from "./fixtures.tsx";
import {
  FakeEventSource,
  mount,
  perform,
  stubFetch,
  type Call,
  type Mounted,
} from "./harness.ts";

let latest: ReturnType<typeof useRoom> | null = null;

function Probe(props: { guild: string }) {
  latest = useRoom(props.guild, true);
  return null;
}

function hook(): ReturnType<typeof useRoom> {
  if (latest === null) throw new Error("The probe did not render");
  return latest;
}

/** A snapshot of `guild` built at server time `at`. */
function snapshot(guild: string, at: number) {
  return roomWith([], { browseGuildId: guild, serverTime: at });
}

function shown() {
  const room = hook().view?.room;
  return room === undefined
    ? null
    : { guild: room.browseGuildId, at: room.serverTime };
}

let calls: Call[];
let view: Mounted;

beforeEach(async () => {
  calls = stubFetch();
  FakeEventSource.install();
  view = await mount(<Probe guild="10" />);
});

afterEach(async () => {
  await view.unmount();
  latest = null;
  vi.unstubAllGlobals();
});

/** The browser lost the stream and reconnected by itself: the page refetches `/api/room`. */
async function reconnectAndRefetch(source: FakeEventSource): Promise<Call> {
  source.readyState = FakeEventSource.CONNECTING;
  await source.emit("error", new Event("error"));
  await source.emit("open", new Event("open"));
  const refetch = calls.at(-1);
  if (refetch?.url !== "/api/room?guildId=10")
    throw new Error("The page did not refetch the room");
  return refetch;
}

describe("useRoom", () => {
  test("a refetch that answers after a newer stream event does not replace it", async () => {
    const source = FakeEventSource.latest();
    await source.message("room", snapshot("10", 1000));
    const refetch = await reconnectAndRefetch(source);

    await source.message("room", snapshot("10", 3000));
    await perform(() => {
      refetch.answer(200, snapshot("10", 2000));
    });

    expect(shown()).toEqual({ guild: "10", at: 3000 });
  });

  test("a refetch that is newer than the room shown replaces it", async () => {
    const source = FakeEventSource.latest();
    await source.message("room", snapshot("10", 1000));
    const refetch = await reconnectAndRefetch(source);
    await perform(() => {
      refetch.answer(200, snapshot("10", 2000));
    });
    expect(shown()).toEqual({ guild: "10", at: 2000 });
  });

  test("switching servers aborts the old server's refetch and drops its answer", async () => {
    // The old answer is already on its way when the page aborts, so it still arrives.
    calls = stubFetch({ ignoreAbort: true });
    const first = FakeEventSource.latest();
    await first.message("room", snapshot("10", 1000));
    const refetch = await reconnectAndRefetch(first);

    await view.rerender(<Probe guild="11" />);
    const second = FakeEventSource.latest();
    expect(second).not.toBe(first);
    expect(second.url).toBe("/api/room/events?guildId=11");
    expect(first.readyState).toBe(FakeEventSource.CLOSED);
    expect(refetch.init?.signal?.aborted).toBe(true);

    await second.message("room", snapshot("11", 1500));
    await perform(() => {
      refetch.answer(200, snapshot("10", 9000));
    });
    expect(shown()).toEqual({ guild: "11", at: 1500 });
  });

  test("switching servers after a refusal connects again", async () => {
    await FakeEventSource.latest().message("error", { code: "guild_denied" });
    expect(hook().connection).toEqual({
      status: "stopped",
      reason: "guild_denied",
    });

    await view.rerender(<Probe guild="11" />);
    expect(FakeEventSource.opened).toHaveLength(2);
    expect(hook().connection.status).toBe("connecting");
    await FakeEventSource.latest().message("room", snapshot("11", 2000));
    expect(hook().connection).toEqual({ status: "live" });
  });

  test("a page restored from the back/forward cache reopens the stream and leaves a refusal", async () => {
    const before = FakeEventSource.latest();
    await before.message("error", { code: "unauthorized" });
    expect(hook().connection.status).toBe("stopped");

    await perform(() => {
      globalThis.dispatchEvent(new PageTransitionEvent("pagehide"));
      globalThis.dispatchEvent(
        new PageTransitionEvent("pageshow", { persisted: true }),
      );
    });

    expect(FakeEventSource.opened).toHaveLength(2);
    expect(before.readyState).toBe(FakeEventSource.CLOSED);
    expect(hook().connection.status).toBe("connecting");
  });
});
