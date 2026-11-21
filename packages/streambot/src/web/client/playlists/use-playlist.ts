import { useEffect, useRef, useState } from "react";
import { PlaylistPageSchema } from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import {
  apiRequest,
  apiUrl,
} from "@shepherdjerred/streambot/web/client/api.ts";
import type { Load } from "@shepherdjerred/streambot/web/client/use-load.ts";
import { PLAYLISTS_URL } from "./playlist-api.ts";
import type { PlaylistPage } from "./playlist-model.ts";

/**
 * One playlist page. `refresh` reloads it in place, keeping the items on screen (and each item's
 * own status line) until the new ones arrive. `revision` is the newest revision this viewer has
 * seen, which edits send; it moves forward as soon as an edit succeeds, before the reload lands,
 * so two quick edits do not collide with each other.
 */
export function usePlaylist(
  guildId: string | null,
  id: string,
  offset: number,
) {
  const [state, setState] = useState<Load<PlaylistPage>>({
    status: "loading",
  });
  const [attempt, setAttempt] = useState(0);
  const silent = useRef(false);
  const revision = useRef<number | null>(null);

  useEffect(() => {
    if (guildId === null) return;
    const controller = new AbortController();
    if (!silent.current) setState({ status: "loading" });
    silent.current = false;
    const load = async () => {
      const result = await apiRequest(
        apiUrl(PLAYLISTS_URL, { guildId, id, offset: String(offset) }),
        PlaylistPageSchema,
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (result.ok) {
        revision.current = result.data.revision;
        setState({ status: "done", data: result.data });
      } else setState({ status: "failed", failure: result.failure });
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [guildId, id, offset, attempt]);

  return {
    state,
    retry: () => {
      setAttempt((value) => value + 1);
    },
    refresh: () => {
      silent.current = true;
      setAttempt((value) => value + 1);
    },
    /** Records the revision an edit produced. */
    adopt: (page: PlaylistPage) => {
      revision.current = page.revision;
    },
    target: () =>
      revision.current === null ? null : { id, revision: revision.current },
  };
}

export type PlaylistHandle = ReturnType<typeof usePlaylist>;
