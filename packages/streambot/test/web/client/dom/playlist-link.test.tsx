// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router";
import type { WebRoom } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  RemoteProvider,
  type Me,
} from "@shepherdjerred/streambot/web/client/remote.tsx";
import { INITIAL_CONNECTION } from "@shepherdjerred/streambot/web/client/room/room-connection.ts";
import { PlaylistPage } from "@shepherdjerred/streambot/web/client/playlists/playlist-page.tsx";
import { ME, ignore, roomWith } from "./fixtures.tsx";
import { mount, settle, stubFetch } from "./harness.ts";

afterEach(() => {
  vi.unstubAllGlobals();
});

const HOME = { id: "10", name: "Home server" };
const OTHER = { id: "11", name: "Other server" };
const TWO_SERVERS: Me = {
  ...ME,
  user: { ...ME.user, guildIds: [HOME.id, OTHER.id] },
  guilds: [HOME, OTHER],
};

async function openLink(room: WebRoom, guild: string) {
  const calls = stubFetch();
  const chosen: string[] = [];
  const view = await mount(
    <MemoryRouter initialEntries={["/playlists/p1?guild=" + guild]}>
      <RemoteProvider
        me={TWO_SERVERS}
        view={{
          room,
          clock: { serverTime: room.serverTime, receivedAt: Date.now() },
        }}
        connection={INITIAL_CONNECTION}
        chooseGuild={(id) => chosen.push(id)}
        reconnect={ignore}
      >
        <Routes>
          <Route path="/playlists/:id" element={<PlaylistPage />} />
        </Routes>
      </RemoteProvider>
    </MemoryRouter>,
  );
  await settle();
  const fetched = calls.some((call) => call.url.includes("/api/playlists"));
  return { view, chosen, fetched };
}

test("a link to another server says why it cannot open while the viewer is in voice elsewhere", async () => {
  const { view, chosen, fetched } = await openLink(
    roomWith([], { guilds: [HOME, OTHER] }),
    OTHER.id,
  );
  expect(view.container.textContent).toContain(
    "This playlist is in Other server",
  );
  expect(view.container.textContent).toContain("which is in Home server");
  expect(view.container.querySelector("[aria-busy=true]")).toBeNull();
  expect(chosen).toEqual([]);
  expect(fetched).toBe(false);
  await view.unmount();
});

test("out of voice, a link to another server switches the remote to it", async () => {
  const { view, chosen, fetched } = await openLink(
    roomWith([], { guilds: [HOME, OTHER], location: null }),
    OTHER.id,
  );
  expect(chosen).toEqual([OTHER.id]);
  expect(fetched).toBe(false);
  expect(view.container.textContent).not.toContain("This playlist is in");
  await view.unmount();
});

test("a link to the server being browsed opens the playlist", async () => {
  const { view, chosen, fetched } = await openLink(
    roomWith([], { guilds: [HOME, OTHER] }),
    HOME.id,
  );
  expect(chosen).toEqual([]);
  expect(fetched).toBe(true);
  await view.unmount();
});
