import { useState, type RefObject } from "react";
import { Artwork } from "@shepherdjerred/streambot/web/client/media/artwork.tsx";
import { PlayActions } from "@shepherdjerred/streambot/web/client/media/play-actions.tsx";
import type { MenuItem } from "@shepherdjerred/streambot/web/client/media/row-menu.tsx";
import type { MediaItem } from "@shepherdjerred/streambot/web/client/media/row-model.ts";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { useControl } from "@shepherdjerred/streambot/web/client/use-control.ts";
import { ChangeStatus } from "./change-status.tsx";
import {
  CopyDialog,
  DeleteDialog,
  ImportDialog,
  RenameDialog,
} from "./playlist-dialogs.tsx";
import {
  playlistDetail,
  shareUrl,
  type PlaylistPage,
} from "./playlist-model.ts";
import type { PlaylistHandle } from "./use-playlist.ts";
import { usePlaylistEdit } from "./use-playlist-edit.ts";
import "@shepherdjerred/streambot/web/client/styles/playlists.css";

type DialogKind = "rename" | "import" | "copy" | "delete";

/** Copies the link, or, when the browser refuses, says the link itself so it can be copied by hand. */
async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    return { ok: true, message: "Link copied." } as const;
  } catch {
    return {
      ok: false,
      failure: {
        status: 0,
        code: "invalid_request",
        message: "Copying was blocked. Copy this link: " + url,
        reference: null,
      },
    } as const;
  }
}

/**
 * The playlist's header: artwork, name, count and state, and the Listen and Watch buttons. Its
 * `⋯` menu holds the play items, then what the viewer may do to the playlist; rename, import,
 * copy and delete each open their own dialog. Sharing and copying the link answer on the line
 * under the header.
 */
export function PlaylistHeader(props: {
  page: PlaylistPage;
  playlist: PlaylistHandle;
  whole: MediaItem;
  artworkUrl: string | undefined;
  heading: RefObject<HTMLHeadingElement | null>;
  onImported: (notice: string) => void;
}) {
  const { page, playlist } = props;
  const remote = useRemote();
  const { edit } = usePlaylistEdit(playlist);
  const status = useControl();
  const [dialog, setDialog] = useState<DialogKind | null>(null);
  const sharing = page.guildId === null;
  const open = (kind: DialogKind): MenuItem => ({
    key: kind,
    label: {
      rename: "Rename…",
      import: "Import from a link…",
      copy: "Copy to your playlists…",
      delete: "Delete playlist…",
    }[kind],
    onSelect: () => {
      setDialog(kind);
    },
  });
  const items: MenuItem[] = [];
  if (page.owned)
    items.push({
      key: "share",
      label: sharing ? "Share with this server" : "Make private",
      onSelect: () => {
        if (status.pending) return;
        edit(
          status,
          { action: sharing ? "publish" : "private" },
          sharing
            ? "Shared with this server."
            : "Only you can see this playlist now.",
        );
      },
    });
  if (!sharing)
    items.push({
      key: "link",
      label: "Copy share link",
      onSelect: () => {
        const url = shareUrl(
          globalThis.location.origin,
          remote.guildId,
          page.id,
        );
        status.run(() => copyLink(url));
      },
    });
  if (page.owned) items.push(open("rename"), open("import"));
  items.push(open("copy"));
  if (page.owned) items.push(open("delete"));
  const close = () => {
    setDialog(null);
  };
  const shared = { page, playlist, onClose: close };
  return (
    <>
      <header className="playlist-head">
        <Artwork
          item={{
            kind: "playlist",
            ...(props.artworkUrl === undefined
              ? {}
              : { artworkUrl: props.artworkUrl }),
          }}
          shape="thumb"
        />
        <div className="playlist-title">
          <h1
            className="page-heading"
            id="page-heading"
            tabIndex={-1}
            ref={props.heading}
          >
            {page.name}
          </h1>
          <p className="muted">{playlistDetail(page)}</p>
        </div>
        <PlayActions item={props.whole} extraMenuItems={items} />
      </header>
      <ChangeStatus control={status} onRefresh={playlist.refresh} />
      {dialog === "rename" && <RenameDialog {...shared} />}
      {dialog === "copy" && <CopyDialog {...shared} />}
      {dialog === "delete" && <DeleteDialog {...shared} />}
      {dialog === "import" && (
        <ImportDialog {...shared} onImported={props.onImported} />
      )}
    </>
  );
}
