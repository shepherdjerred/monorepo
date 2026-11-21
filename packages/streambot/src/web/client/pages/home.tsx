import { useState } from "react";
import { Link } from "react-router";
import { LibraryBrowsePageSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { SearchResponseSchema } from "@shepherdjerred/streambot/web/shared/search-contracts.ts";
import { PlaylistListSchema } from "@shepherdjerred/streambot/music/playlist-contracts.ts";
import { apiUrl } from "@shepherdjerred/streambot/web/client/api.ts";
import { ItemSection } from "@shepherdjerred/streambot/web/client/media/item-section.tsx";
import {
  libraryItem,
  playlistItem,
} from "@shepherdjerred/streambot/web/client/media/media-items.ts";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { rowItem } from "@shepherdjerred/streambot/web/client/media/row-model.ts";
import { StationDialog } from "./station-dialog.tsx";
import { useLoad } from "@shepherdjerred/streambot/web/client/use-load.ts";
import "@shepherdjerred/streambot/web/client/styles/home.css";

const HOME_ROWS = 6;
const HOME_POSTERS = 12;

/** `/api/search/v2` with no query lists a group's recent items: history and today's games. */
export function groupUrl(
  guildId: string,
  kind: "history" | "live",
  on: boolean,
) {
  return on && guildId !== ""
    ? apiUrl("/api/search/v2", { guildId, kind, q: "" })
    : null;
}

function StationButtons() {
  const remote = useRemote();
  const [open, setOpen] = useState<"radio" | "tv" | null>(null);
  const capabilities = remote.room?.capabilities;
  if (capabilities === undefined || (!capabilities.radio && !capabilities.tv))
    return null;
  return (
    <div className="btn-row">
      {capabilities.radio && (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setOpen("radio");
          }}
        >
          <span className="glyph" aria-hidden="true">
            ♪
          </span>
          Start Radio
        </button>
      )}
      {capabilities.tv && (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setOpen("tv");
          }}
        >
          <span className="glyph" aria-hidden="true">
            ▶
          </span>
          Start TV
        </button>
      )}
      {open !== null && (
        <StationDialog
          kind={open}
          onClose={() => {
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

/** Empty search: recent plays, live games, playlists, the library, and stations. */
export function Home() {
  const remote = useRemote();
  const capabilities = remote.room?.capabilities;
  const guildId = remote.room === null ? "" : remote.guildId;
  const history = useLoad(
    groupUrl(guildId, "history", capabilities?.history === true),
    SearchResponseSchema,
  );
  const live = useLoad(
    groupUrl(guildId, "live", capabilities?.sports === true),
    SearchResponseSchema,
  );
  const playlists = useLoad(
    guildId !== "" && capabilities?.playlists === true
      ? apiUrl("/api/playlists", { guildId, scope: "mine" })
      : null,
    PlaylistListSchema,
  );
  const library = useLoad(
    guildId === "" ? null : apiUrl("/api/library", { guildId, view: "titles" }),
    LibraryBrowsePageSchema,
  );
  const listen = capabilities?.listen === true;
  return (
    <div className="home">
      <div className="home-head">
        <h1 className="page-heading" id="page-heading" tabIndex={-1}>
          Home
        </h1>
        <StationButtons />
      </div>
      <div className="home-pair">
        {capabilities?.history === true && (
          <ItemSection
            title="Jump back in"
            load={history.state}
            onRetry={history.retry}
            items={(data) =>
              data.items.slice(0, HOME_ROWS).map((row) => rowItem(row))
            }
            empty="Nothing played here yet."
            aside={<Link to="/history">History</Link>}
          />
        )}
        {capabilities?.sports === true && (
          <ItemSection
            title="Live now"
            load={live.state}
            onRetry={live.retry}
            items={(data) =>
              data.items.slice(0, HOME_ROWS).map((row) => rowItem(row))
            }
            empty="No games today."
            aside={<Link to="/live">All games</Link>}
          />
        )}
      </div>
      {capabilities?.playlists === true && (
        <ItemSection
          title="Your playlists"
          load={playlists.state}
          onRetry={playlists.retry}
          items={(data) =>
            data.slice(0, HOME_ROWS).map((item) => playlistItem(item, listen))
          }
          empty="You have no playlists yet."
          aside={<Link to="/playlists">Playlists</Link>}
        />
      )}
      <ItemSection
        title="From your library"
        layout="cards"
        load={library.state}
        onRetry={library.retry}
        items={(data) =>
          data.items.slice(0, HOME_POSTERS).map((item) => libraryItem(item))
        }
        empty="The library is empty."
        aside={<Link to="/library">Library</Link>}
      />
    </div>
  );
}
