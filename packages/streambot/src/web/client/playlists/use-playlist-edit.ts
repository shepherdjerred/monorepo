import type { z } from "zod";
import {
  PlaylistPageSchema,
  type PlaylistMutationSchema,
} from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import { CommandResultSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import type { Control } from "@shepherdjerred/streambot/web/client/use-control.ts";
import { mutationTask, type Built } from "./playlist-api.ts";
import {
  playlistRequest,
  type PlaylistChange,
  type PlaylistPage,
} from "./playlist-model.ts";
import type { PlaylistHandle } from "./use-playlist.ts";

type Action = z.infer<typeof PlaylistMutationSchema>["action"];

/** What the viewer is told once an edit lands; a delete has no page left to describe. */
type Words = string | ((page: PlaylistPage) => string);

function words(value: Words, page: PlaylistPage): string {
  return typeof value === "string" ? value : value(page);
}

/**
 * Sends an edit of the open playlist on one control. A success adopts the new revision and
 * reloads the page's items in place. The edit carries the revision the viewer last saw, so a
 * playlist someone else changed is refused with `playlist_changed` instead of overwritten.
 */
export function usePlaylistEdit(playlist: PlaylistHandle) {
  const remote = useRemote();
  const build =
    (change: PlaylistChange): (() => Built) =>
    () => {
      const target = playlist.target();
      return target === null
        ? {
            ok: false,
            failure: {
              status: 0,
              code: "unavailable",
              message: "",
              reference: null,
            },
          }
        : {
            ok: true,
            body: playlistRequest(remote.guildId, target, change),
          };
    };
  return {
    edit: (
      control: Control,
      change: PlaylistChange & { action: Exclude<Action, "delete"> },
      message: Words,
      after?: (page: PlaylistPage) => void,
    ) => {
      control.run(
        mutationTask(remote, PlaylistPageSchema, build(change), (page) => {
          playlist.adopt(page);
          playlist.refresh();
          after?.(page);
          return words(message, page);
        }),
      );
    },
    /** A private copy is a different playlist, so the open one keeps its revision. */
    copy: (
      control: Control,
      name: string,
      after: (copy: PlaylistPage) => void,
    ) => {
      control.run(
        mutationTask(
          remote,
          PlaylistPageSchema,
          build({ action: "copy", name }),
          (page) => {
            after(page);
            return "Copied to your playlists.";
          },
        ),
      );
    },
    remove: (control: Control, after: () => void) => {
      control.run(
        mutationTask(
          remote,
          CommandResultSchema,
          build({ action: "delete" }),
          (result) => {
            after();
            return result.message;
          },
        ),
      );
    },
  };
}
