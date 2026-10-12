// Who this browser is signed in as, against the sign-in routes core serves.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Socket } from "socket.io-client";
import {
  AUTH_LOGOUT_PATH,
  AUTH_START_PATH,
  ME_PATH,
  MeSchema,
  type Me,
} from "@shepherdjerred/discord-plays-core/auth/protocol.ts";

export const ME_QUERY_KEY = ["me"] as const;

const SIGNED_OUT: Me = { signedIn: false };

async function fetchMe(): Promise<Me> {
  const response = await fetch(ME_PATH, { credentials: "same-origin" });
  if (!response.ok) {
    throw new Error(
      `Could not load your Discord session (${String(response.status)}).`,
    );
  }
  return MeSchema.parse(await response.json());
}

/**
 * Who this browser is signed in as. A failed lookup reads as signed out: the
 * page stays usable for watching, and the server, not this value, decides who
 * may play.
 */
export function useMe(): { me: Me; loading: boolean } {
  const query = useQuery({
    queryKey: ME_QUERY_KEY,
    queryFn: fetchMe,
    retry: 1,
    staleTime: 60_000,
  });
  return { me: query.data ?? SIGNED_OUT, loading: query.isPending };
}

/** Start Discord sign-in, coming back to this page afterwards. */
export function signIn(): void {
  const returnTo = globalThis.location.pathname;
  globalThis.location.assign(
    `${AUTH_START_PATH}?${new URLSearchParams({ returnTo }).toString()}`,
  );
}

/** Sign out, then reconnect the socket so the server drops this identity. */
export function useSignOut(socket: Socket): () => Promise<void> {
  const queryClient = useQueryClient();
  return async () => {
    const response = await fetch(AUTH_LOGOUT_PATH, {
      method: "POST",
      credentials: "same-origin",
      redirect: "manual",
    });
    if (!response.ok) {
      throw new Error(`Could not sign out (${String(response.status)}).`);
    }
    queryClient.setQueryData<Me>(ME_QUERY_KEY, SIGNED_OUT);
    socket.disconnect().connect();
  };
}
