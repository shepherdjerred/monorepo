// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { WebRoomPlayer } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  PlayerControls,
  Timeline,
} from "@shepherdjerred/streambot/web/client/room/player-controls.tsx";
import { ignore, InRoom, listenPlayer, roomWith } from "./fixtures.tsx";
import {
  advance,
  mount,
  perform,
  stubFetch,
  type Call,
  type Mounted,
} from "./harness.ts";

let calls: Call[];
let view: Mounted;

function show(player: WebRoomPlayer) {
  return (
    <InRoom room={roomWith([player])}>
      <Timeline player={player} />
      <PlayerControls player={player} onSubtitles={ignore} />
    </InRoom>
  );
}

function slider(name: "Seek" | "Volume"): HTMLInputElement {
  const input =
    name === "Seek"
      ? view.container.querySelector('input[aria-label="Seek"]')
      : view.container.querySelector(".volume input");
  if (!(input instanceof HTMLInputElement)) throw new TypeError("No " + name);
  return input;
}

/** Drags a range input to `value` and lets it rest until the command is sent. */
async function drag(name: "Seek" | "Volume", value: number) {
  const input = slider(name);
  await perform(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await advance(350);
}

beforeEach(async () => {
  vi.useFakeTimers();
  calls = stubFetch();
  view = await mount(show(listenPlayer({ volume: 100 })));
});

afterEach(async () => {
  await view.unmount();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("volume", () => {
  test("holds the dragged value through unrelated snapshots until the room shows it", async () => {
    await drag("Volume", 50);
    expect(calls.map((call) => call.body)).toMatchObject([
      { action: "volume", percent: 50 },
    ]);

    // Another snapshot restamps the position but still carries the old volume.
    await view.rerender(show(listenPlayer({ volume: 100, positionAt: 6000 })));
    expect(slider("Volume").value).toBe("50");

    await perform(() => {
      calls[0]?.answer(200, { message: "Volume 50%." });
    });
    await view.rerender(show(listenPlayer({ volume: 50, positionAt: 7000 })));
    expect(slider("Volume").value).toBe("50");

    // Someone else turns it up: the room's value shows, nothing of the old drag remains.
    await view.rerender(show(listenPlayer({ volume: 120, positionAt: 8000 })));
    expect(slider("Volume").value).toBe("120");
  });

  test("a failed command puts back the volume that is really playing", async () => {
    await drag("Volume", 50);
    await perform(() => {
      calls[0]?.answer(503, { code: "busy", message: "" });
    });
    expect(slider("Volume").value).toBe("100");
    expect(view.container.textContent).toContain("Streambot is busy");
  });
});

describe("seek", () => {
  test("holds the dragged position through unrelated snapshots until the room shows it", async () => {
    await drag("Seek", 200);
    expect(calls[0]?.body).toMatchObject({ action: "seek", seconds: 200 });

    await view.rerender(
      show(listenPlayer({ positionSeconds: 31, positionAt: 6000 })),
    );
    expect(slider("Seek").value).toBe("200");

    await perform(() => {
      calls[0]?.answer(200, { message: "" });
    });
    await view.rerender(
      show(listenPlayer({ positionSeconds: 200, positionAt: 7000 })),
    );
    expect(slider("Seek").value).toBe("200");
  });

  test("a failed seek returns the thumb to the playing position", async () => {
    await drag("Seek", 200);
    await perform(() => {
      calls[0]?.answer(409, { code: "item_finished", message: "" });
    });
    expect(Number(slider("Seek").value)).toBeLessThan(40);
  });
});
