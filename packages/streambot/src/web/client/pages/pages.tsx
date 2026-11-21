import { Link, useParams, useSearchParams } from "react-router";
import {
  LibraryBrowsePageSchema,
  LibraryPageSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import {
  BrowsePageSchema,
  SearchResponseSchema,
} from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import { PlaylistListSchema } from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import { apiUrl } from "@shepherdjerred/streambot/web/client/api.ts";
import { groupUrl } from "./home.tsx";
import { ItemSection } from "@shepherdjerred/streambot/web/client/media/item-section.tsx";
import {
  libraryEntry,
  libraryItem,
  playlistItem,
} from "@shepherdjerred/streambot/web/client/media/media-items.ts";
import { PlayActions } from "@shepherdjerred/streambot/web/client/media/play-actions.tsx";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { rowItem } from "@shepherdjerred/streambot/web/client/media/row-model.ts";
import { useLoad } from "@shepherdjerred/streambot/web/client/use-load.ts";
import "@shepherdjerred/streambot/web/client/styles/home.css";

/*
 * Phase-one browse pages: a heading and a real list built from the shared row component. Filters,
 * paging, and playlist editing come with the full pages.
 */

function useGuild(): string {
  const remote = useRemote();
  return remote.room === null ? "" : remote.guildId;
}

function Disabled(props: { title: string; reason: string }) {
  return (
    <div className="page">
      <h1 className="page-heading" id="page-heading" tabIndex={-1}>
        {props.title}
      </h1>
      <p className="empty-note">{props.reason}</p>
    </div>
  );
}

export function LibraryPage() {
  const guildId = useGuild();
  const [params] = useSearchParams();
  const series = params.get("series") ?? "";
  const titles = useLoad(
    guildId === "" || series !== ""
      ? null
      : apiUrl("/api/library", { guildId, view: "titles" }),
    LibraryBrowsePageSchema,
  );
  const episodes = useLoad(
    guildId === "" || series === ""
      ? null
      : apiUrl("/api/library", { guildId, view: "entries", series }),
    LibraryPageSchema,
  );
  return series === "" ? (
    <ItemSection
      headingLevel="h1"
      title="Library"
      layout="cards"
      load={titles.state}
      onRetry={titles.retry}
      items={(data) => data.items.map((item) => libraryItem(item))}
      empty="The library is empty."
    />
  ) : (
    <ItemSection
      headingLevel="h1"
      title={series}
      load={episodes.state}
      onRetry={episodes.retry}
      items={(data) => data.items.map((item) => libraryEntry(item))}
      empty="No episodes found."
      aside={<Link to="/library">All titles</Link>}
    />
  );
}

export function PlaylistsPage() {
  const remote = useRemote();
  const guildId = useGuild();
  const enabled = remote.room?.capabilities.playlists === true;
  const listen = remote.room?.capabilities.listen === true;
  const mine = useLoad(
    enabled && guildId !== ""
      ? apiUrl("/api/playlists", { guildId, scope: "mine" })
      : null,
    PlaylistListSchema,
  );
  const server = useLoad(
    enabled && guildId !== ""
      ? apiUrl("/api/playlists", { guildId, scope: "server" })
      : null,
    PlaylistListSchema,
  );
  if (!enabled && remote.room !== null)
    return (
      <Disabled
        title="Playlists"
        reason="Playlists are not enabled in this server."
      />
    );
  return (
    <div className="page">
      <ItemSection
        headingLevel="h1"
        title="Your playlists"
        load={mine.state}
        onRetry={mine.retry}
        items={(data) => data.map((item) => playlistItem(item, listen))}
        empty="You have no playlists yet."
      />
      <ItemSection
        title="Shared in this server"
        load={server.state}
        onRetry={server.retry}
        items={(data) => data.map((item) => playlistItem(item, listen))}
        empty="Nobody has shared a playlist here yet."
      />
    </div>
  );
}

function GroupPage(props: {
  kind: "live" | "history";
  title: string;
  off: string;
  empty: string;
}) {
  const remote = useRemote();
  const capabilities = remote.room?.capabilities;
  const on =
    props.kind === "live"
      ? capabilities?.sports === true
      : capabilities?.history === true;
  const load = useLoad(
    groupUrl(useGuild(), props.kind, on),
    SearchResponseSchema,
  );
  if (capabilities !== undefined && !on)
    return <Disabled title={props.title} reason={props.off} />;
  return (
    <ItemSection
      headingLevel="h1"
      title={props.title}
      load={load.state}
      onRetry={load.retry}
      items={(data) => data.items.map((row) => rowItem(row))}
      empty={props.empty}
    />
  );
}

export function LivePage() {
  return (
    <GroupPage
      kind="live"
      title="Live games"
      off="Live sports are not enabled in this server."
      empty="No games today."
    />
  );
}

export function HistoryPage() {
  return (
    <GroupPage
      kind="history"
      title="History"
      off="Playback history is not enabled in this server."
      empty="Nothing played here yet."
    />
  );
}

/** An album or artist page from a search result. An album can also be played whole. */
export function BrowsePage(props: { kind: "album" | "artist" }) {
  const guildId = useGuild();
  const { id = "" } = useParams();
  const load = useLoad(
    guildId === "" || id === ""
      ? null
      : apiUrl("/api/music/v2/" + props.kind, { guildId, id }),
    BrowsePageSchema,
  );
  const page = load.state.status === "done" ? load.state.data : null;
  return (
    <ItemSection
      headingLevel="h1"
      title={
        page?.header.title ?? (props.kind === "album" ? "Album" : "Artist")
      }
      load={load.state}
      onRetry={load.retry}
      items={(data) => data.rows.map((row) => rowItem(row))}
      empty="No tracks found."
      aside={
        page?.play === undefined ? undefined : (
          <div className="section-play">
            <PlayActions
              item={{
                key: "album:" + page.play.id,
                kind: "album",
                title: page.header.title,
                actions: page.play.actions,
                selection: { kind: "music", id: page.play.id },
              }}
            />
          </div>
        )
      }
    />
  );
}
