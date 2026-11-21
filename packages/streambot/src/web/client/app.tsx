import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { MeSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { FailureNotice } from "./failure-notice.tsx";
import { Header, Legend } from "./header.tsx";
import { Home } from "./pages/home.tsx";
import {
  BrowsePage,
  HistoryPage,
  LibraryPage,
  LivePage,
  PlaylistsPage,
} from "./pages/pages.tsx";
import { Rail } from "./room/rail.tsx";
import { RemoteProvider, type Me } from "./remote.tsx";
import { Results } from "./search/results.tsx";
import { useQuery } from "./search/search-box.tsx";
import { useLoad } from "./use-load.ts";
import { useRoom } from "./room/use-room.ts";
import "./styles/shell.css";

const TITLES: Readonly<Record<string, string>> = {
  "/library": "Library",
  "/playlists": "Playlists",
  "/live": "Live games",
  "/history": "History",
};

function usePageTitle(query: string) {
  const { pathname } = useLocation();
  useEffect(() => {
    const name =
      query === "" ? (TITLES[pathname] ?? "Home") : "Search: " + query;
    document.title = name + " · Streambot";
  }, [pathname, query]);
}

function SignIn() {
  const location = useLocation();
  const href =
    "/api/auth/discord/start?" +
    new URLSearchParams({
      returnTo: location.pathname + location.search,
    }).toString();
  return (
    <main className="welcome">
      <h1 className="page-heading">Streambot</h1>
      <p>
        Play music and video in your Discord voice channel. Listen puts audio in
        the channel for everyone; Watch starts a stream people open.
      </p>
      <a className="btn btn-watch" href={href}>
        Sign in with Discord
      </a>
    </main>
  );
}

function SearchOrHome() {
  const [query] = useQuery();
  return query.trim() === "" ? <Home /> : <Results query={query} />;
}

function Remote(props: { me: Me }) {
  const [guildHint, setGuildHint] = useState<string | null>(null);
  const room = useRoom(guildHint, true);
  const [query] = useQuery();
  usePageTitle(query);
  return (
    <RemoteProvider
      me={props.me}
      view={room.view}
      connection={room.connection}
      chooseGuild={setGuildHint}
      reconnect={room.reconnect}
    >
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Header />
      <div className="layout">
        <main id="main" className="content" tabIndex={-1}>
          <Legend />
          <Routes>
            <Route path="/" element={<SearchOrHome />} />
            <Route path="/library" element={<LibraryPage />} />
            <Route path="/playlists" element={<PlaylistsPage />} />
            <Route path="/live" element={<LivePage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/album/:id" element={<BrowsePage kind="album" />} />
            <Route path="/artist/:id" element={<BrowsePage kind="artist" />} />
            <Route path="*" element={<Navigate replace to="/" />} />
          </Routes>
        </main>
        <Rail />
      </div>
      <footer className="footer">
        <a href="/classic">Classic remote</a>
        <span className="footer-credit">
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
            <img src="/tmdb.svg" alt="TMDB" width="46" height="20" />
          </a>
          This product uses the TMDB API but is not endorsed or certified by
          TMDB. Video thumbnails are provided by YouTube.
        </span>
      </footer>
    </RemoteProvider>
  );
}

/** Sign-in gate, then the remote: header, the current page, and the now-playing rail. */
export function App() {
  const me = useLoad("/api/me", MeSchema);
  if (me.state.status === "loading")
    return (
      <main className="welcome" aria-busy="true">
        <p className="muted">Connecting to Streambot…</p>
      </main>
    );
  if (me.state.status === "failed")
    return me.state.failure.status === 401 ? (
      <SignIn />
    ) : (
      <main className="welcome">
        <h1 className="page-heading">Streambot</h1>
        <p className="status">
          <FailureNotice failure={me.state.failure} onRetry={me.retry} />
        </p>
      </main>
    );
  if (me.state.data.guilds.length === 0)
    return (
      <main className="welcome">
        <h1 className="page-heading">No shared servers</h1>
        <p>
          Streambot needs to be in a Discord server you belong to. Sign in again
          after it joins one.
        </p>
      </main>
    );
  return <Remote me={me.state.data} />;
}
