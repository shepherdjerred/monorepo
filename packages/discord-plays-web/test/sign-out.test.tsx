import { afterEach, expect, test, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { io } from "socket.io-client";
import { ME_QUERY_KEY, useSignOut } from "#src/session/me.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test.each([200, 503])(
  "logout HTTP %s updates identity only after success",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response(null, { status }))),
    );
    const socket = io({ autoConnect: false });
    const disconnect = vi.spyOn(socket, "disconnect").mockReturnValue(socket);
    const connect = vi.spyOn(socket, "connect").mockReturnValue(socket);
    const client = new QueryClient();
    const signedIn = {
      signedIn: true,
      user: {
        discordId: "42",
        username: "trainer",
        name: "May",
        avatarUrl: null,
      },
    };
    client.setQueryData(ME_QUERY_KEY, signedIn);
    let signOut: (() => Promise<void>) | undefined;
    function Harness() {
      signOut = useSignOut(socket);
      return null;
    }
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );
    if (signOut === undefined) throw new Error("sign out was not mounted");
    try {
      if (status === 200) {
        await signOut();
        expect(client.getQueryData(ME_QUERY_KEY)).toEqual({ signedIn: false });
        expect(disconnect).toHaveBeenCalledOnce();
        expect(connect).toHaveBeenCalledOnce();
      } else {
        await expect(signOut()).rejects.toThrow("Could not sign out");
        expect(client.getQueryData(ME_QUERY_KEY)).toEqual(signedIn);
        expect(disconnect).not.toHaveBeenCalled();
        expect(connect).not.toHaveBeenCalled();
      }
    } finally {
      client.clear();
    }
  },
);
