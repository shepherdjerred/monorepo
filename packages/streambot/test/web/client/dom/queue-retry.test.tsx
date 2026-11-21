// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { QueueList } from "@shepherdjerred/streambot/web/client/room/queue-list.tsx";
import type { WebRoom } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { InRoom, listenPlayer, queued, roomWith } from "./fixtures.tsx";
import {
  button,
  click,
  hasButton,
  mount,
  settle,
  stubFetch,
  type Call,
  type Mounted,
} from "./harness.ts";

const FOUR = roomWith([
  listenPlayer({
    revision: "r1",
    queue: ["a", "b", "c", "d"].map((name) => queued(name)),
  }),
]);
/** Someone else removed #1 ("a"): "c" is now #2 and the old #4 ("d") is #3. */
const THREE = roomWith([
  listenPlayer({
    revision: "r2",
    queue: ["b", "c", "d"].map((name) => queued(name)),
  }),
]);

let calls: Call[];
let view: Mounted;

function show(room: WebRoom) {
  const player = room.players[0];
  if (player === undefined) throw new Error("The room needs a player");
  return (
    <InRoom room={room}>
      <QueueList player={player} />
    </InRoom>
  );
}

beforeEach(async () => {
  calls = stubFetch();
  view = await mount(show(FOUR));
});

afterEach(async () => {
  await view.unmount();
  vi.unstubAllGlobals();
});

function commands(): Call[] {
  return calls.filter((call) => call.url === "/api/commands");
}

async function removeCAndLoseTheNetwork() {
  await click(button(view.container, "Remove c from the queue"));
  expect(commands().map((call) => call.body)).toMatchObject([
    { action: "remove", position: 3, revision: "r1" },
  ]);
  commands()[0]?.failNetwork();
  await settle();
}

describe("queue edits are pinned to the list they were clicked in", () => {
  test("Retry after the queue changed refuses locally and sends nothing", async () => {
    await removeCAndLoseTheNetwork();
    expect(view.container.textContent).toContain("could not be reached");

    await view.rerender(show(THREE));
    await click(button(view.container, "Retry"));

    expect(commands()).toHaveLength(1);
    expect(view.container.textContent).toContain("The queue changed");
    expect(hasButton(view.container, "Retry")).toBe(false);
  });

  test("Retry on an unchanged queue resends the clicked position and revision", async () => {
    await removeCAndLoseTheNetwork();
    await click(button(view.container, "Retry"));

    expect(commands().map((call) => call.body)).toMatchObject([
      { action: "remove", position: 3, revision: "r1" },
      { action: "remove", position: 3, revision: "r1" },
    ]);
  });

  test("Retry keeps the clicked revision even when the item is still in place", async () => {
    await removeCAndLoseTheNetwork();
    // Something was appended: "c" is still #3 but the revision moved on.
    await view.rerender(
      show(
        roomWith([
          listenPlayer({
            revision: "r3",
            queue: ["a", "b", "c", "d", "e"].map((name) => queued(name)),
          }),
        ]),
      ),
    );
    await click(button(view.container, "Retry"));
    expect(commands()[1]?.body).toMatchObject({ position: 3, revision: "r1" });
  });

  test("the server's playback_changed is shown as a changed queue without Retry", async () => {
    await click(button(view.container, "Move c up"));
    expect(commands()[0]?.body).toMatchObject({
      action: "move",
      from: 3,
      to: 2,
      revision: "r1",
    });
    commands()[0]?.answer(409, {
      code: "playback_changed",
      message: "Playback or the queue changed. Refresh and try again.",
    });
    await settle();

    expect(view.container.textContent).toContain("The queue changed");
    expect(hasButton(view.container, "Retry")).toBe(false);
  });
});
