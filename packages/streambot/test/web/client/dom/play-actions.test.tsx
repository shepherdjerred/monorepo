// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { WebRoom } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { PlayActions } from "@shepherdjerred/streambot/web/client/media/play-actions.tsx";
import type { MediaItem } from "@shepherdjerred/streambot/web/client/media/row-model.ts";
import { InRoom, listenPlayer, queued, roomWith } from "./fixtures.tsx";
import {
  button,
  click,
  hasButton,
  mount,
  perform,
  stubFetch,
  type Call,
  type Mounted,
} from "./harness.ts";

const CLIP: MediaItem = {
  key: "video:clip",
  kind: "video",
  title: "Clip",
  actions: ["watch"],
  selection: { kind: "candidate", id: "clip" },
};

const MENU = "More ways to play Clip";

function watchPlayer(playing: boolean) {
  return listenPlayer({
    slot: 2,
    transport: "watch",
    current: playing ? queued("stream") : null,
  });
}

let calls: Call[];
let view: Mounted;

beforeEach(() => {
  calls = stubFetch();
});

afterEach(async () => {
  await view.unmount();
  vi.unstubAllGlobals();
});

async function openMenu(room: WebRoom) {
  view = await mount(
    <InRoom room={room}>
      <PlayActions item={CLIP} />
    </InRoom>,
  );
  await click(button(view.container, MENU));
}

describe("Start another stream", () => {
  test("is not offered while nothing is on Watch", async () => {
    await openMenu(roomWith([listenPlayer()]));
    expect(hasButton(view.container, "Play next")).toBe(true);
    expect(hasButton(view.container, "Start another stream")).toBe(false);
  });

  test("is not offered while the Watch player is idle", async () => {
    await openMenu(roomWith([listenPlayer(), watchPlayer(false)]));
    expect(hasButton(view.container, "Start another stream")).toBe(false);
  });

  test("is offered once something is on Watch and a slot is free", async () => {
    await openMenu(roomWith([listenPlayer(), watchPlayer(true)]));
    await click(button(view.container, "Start another stream"));
    expect(calls.map((call) => call.body)).toMatchObject([
      { action: "play", transport: "watch", playbackChannel: 3 },
    ]);
  });
});

describe("the menu while one of its actions is in flight", () => {
  test("shows the trigger busy and starts no second action", async () => {
    await openMenu(roomWith([listenPlayer(), watchPlayer(true)]));
    await click(button(view.container, "Play next"));
    expect(calls).toHaveLength(1);

    const trigger = button(view.container, MENU);
    expect(trigger.getAttribute("aria-busy")).toBe("true");
    await click(trigger);
    expect(hasButton(view.container, "Play now")).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.init?.signal?.aborted).toBe(false);

    await perform(() => {
      calls[0]?.answer(200, { message: "Queued.", position: 2 });
    });
    expect(trigger.getAttribute("aria-busy")).toBe("false");
    expect(view.container.textContent).toContain("Added to Watch queue · #2");
  });
});
