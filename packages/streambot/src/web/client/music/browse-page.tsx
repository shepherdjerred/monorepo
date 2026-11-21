import { useParams } from "react-router";
import {
  BrowsePageSchema,
  type BrowsePage as BrowseData,
} from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import { apiUrl } from "@shepherdjerred/streambot/web/client/api.ts";
import { Artwork } from "@shepherdjerred/streambot/web/client/media/artwork.tsx";
import { ItemSection } from "@shepherdjerred/streambot/web/client/media/item-section.tsx";
import { PlayActions } from "@shepherdjerred/streambot/web/client/media/play-actions.tsx";
import { rowItem } from "@shepherdjerred/streambot/web/client/media/row-model.ts";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { useLoad } from "@shepherdjerred/streambot/web/client/use-load.ts";
import { useBrowseGuild } from "@shepherdjerred/streambot/web/client/library/browse-state.ts";
import { DisabledPage } from "@shepherdjerred/streambot/web/client/library/disabled-page.tsx";
import { PageHeading } from "@shepherdjerred/streambot/web/client/library/page-heading.tsx";
import { albumPlayItem } from "./browse-items.ts";
import "@shepherdjerred/streambot/web/client/styles/browse.css";

const FALLBACK_TITLE = { album: "Album", artist: "Artist" } as const;

/** Artwork, title and subtitle, and for an album the buttons that queue all of it. */
function Header(props: { page: BrowseData }) {
  const { header } = props.page;
  const play = albumPlayItem(props.page);
  return (
    <div className="album-head">
      <Artwork
        item={{
          kind: header.kind,
          ...(header.artworkUrl === undefined
            ? {}
            : { artworkUrl: header.artworkUrl }),
        }}
        shape="poster"
      />
      <div className="album-head-text">
        <PageHeading title={header.title} />
        {header.subtitle !== undefined && (
          <p className="muted">{header.subtitle}</p>
        )}
        {play !== null && <PlayActions item={play} />}
      </div>
    </div>
  );
}

/** An album or artist page opened from a search result. */
export function BrowsePage(props: { kind: "album" | "artist" }) {
  const remote = useRemote();
  const guildId = useBrowseGuild();
  const { id = "" } = useParams();
  const capabilities = remote.room?.capabilities;
  const load = useLoad(
    guildId !== "" && id !== "" && capabilities?.musicCatalog === true
      ? apiUrl("/api/music/v2/" + props.kind, { guildId, id })
      : null,
    BrowsePageSchema,
  );
  if (capabilities !== undefined && !capabilities.musicCatalog)
    return (
      <DisabledPage
        title={FALLBACK_TITLE[props.kind]}
        reason="Music browsing is not enabled in this server."
      />
    );
  const page = load.state.status === "done" ? load.state.data : null;
  return (
    <div className="page">
      {page === null ? (
        <PageHeading title={FALLBACK_TITLE[props.kind]} />
      ) : (
        <Header page={page} />
      )}
      <ItemSection
        title={props.kind === "album" ? "Tracks" : "Songs and albums"}
        load={load.state}
        onRetry={load.retry}
        items={(data) => data.rows.map((row) => rowItem(row))}
        empty={
          props.kind === "album"
            ? "This album has no playable tracks."
            : "Nothing to show for this artist."
        }
      />
    </div>
  );
}
