import { useMutation, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { logout, readSession, sessionBoundary } from "./api.ts";
import { Login } from "./login.tsx";
import { ErrorNotice, Loading } from "./components.tsx";
import { Discover, CatalogPage } from "./catalog.tsx";
import {
  RequestsPage,
  ActivityPage,
  RemovalsPage,
  NotificationsPage,
  AdminPage,
} from "./lists.tsx";
import { MediaPage } from "./media.tsx";
import { NotificationCallback } from "./preferences.tsx";
import { MigrationPage } from "./migration.tsx";
import { RecoveryPage } from "./recovery/page.tsx";
import { NativeRecoveryPage } from "./native-recovery/page.tsx";
import { SubtitleReplacementPage } from "./subtitle-replacement/page.tsx";

export function App() {
  const session = useQuery({
    queryKey: ["me"],
    queryFn: readSession,
  });
  const current = useSyncExternalStore(
    sessionBoundary.subscribe,
    sessionBoundary.getSnapshot,
    sessionBoundary.getSnapshot,
  );
  if (current.user === null) return <Login key={current.generation} />;
  if (session.error !== null)
    return (
      <main className="session-state">
        <ErrorNotice error={session.error} />
        <button
          className="button"
          onClick={() => {
            void session.refetch();
          }}
        >
          Try again
        </button>
      </main>
    );
  if (current.user === undefined)
    return (
      <main className="session-state">
        <Loading />
      </main>
    );
  return <Shell key={current.generation} user={current.user} />;
}

function Shell({ user }: { user: MediaUser }) {
  const signOut = useMutation({
    mutationFn: logout,
  });
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <NavLink className="brand" to="/">
          <span className="brand-mark" aria-hidden="true">
            m
          </span>{" "}
          media<span className="brand-dot">.</span>
        </NavLink>
        <p className="nav-label">Your library</p>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            <span aria-hidden="true">✦</span> Discover
          </NavLink>
          <NavLink to="/requests">
            <span aria-hidden="true">▤</span> My requests
          </NavLink>
          <NavLink to="/activity">
            <span aria-hidden="true">⌁</span> Activity
          </NavLink>
          <NavLink to="/removals">
            <span aria-hidden="true">◷</span> Leaving soon
          </NavLink>
          <NavLink to="/notifications">
            <span aria-hidden="true">◉</span> Notifications
          </NavLink>
          <NavLink to="/recovery">
            <span aria-hidden="true">◇</span> Recovery review
          </NavLink>
          {user.role === "owner" && (
            <NavLink to="/admin" end>
              <span aria-hidden="true">⚙</span> Administration
            </NavLink>
          )}
          {user.role === "owner" && (
            <NavLink to="/admin/migration">
              <span aria-hidden="true">⇥</span> Migration review
            </NavLink>
          )}
        </nav>
        <div className="sidebar-bottom">
          <span className="avatar" aria-hidden="true">
            {user.displayName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{user.displayName}</strong>
            <span>
              {user.role === "owner" ? "Library owner" : "Library member"}
            </span>
          </div>
          <button
            className="signout"
            aria-label="Sign out"
            title="Sign out"
            disabled={signOut.isPending}
            onClick={() => {
              signOut.mutate();
            }}
          >
            ↗
          </button>
        </div>
      </aside>
      <main id="main" className="main-content">
        <div className="topline">
          <span>THE HOUSEHOLD COLLECTION</span>
          <span className="topline-account">
            Plex account <i aria-hidden="true" />
          </span>
        </div>
        {user.restricted && (
          <div className="notice">
            New requests are paused for your account. You can still view your
            library and manage existing requests.
          </div>
        )}
        {signOut.error !== null && <ErrorNotice error={signOut.error} />}
        <Routes>
          <Route
            path="/admin/subtitle-replacements/:id?"
            element={
              user.role === "owner" ? (
                <SubtitleReplacementPage user={user} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/recovery/native"
            element={
              user.role === "owner" ? (
                <NativeRecoveryPage user={user} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/recovery/native/:id"
            element={
              user.role === "owner" ? (
                <NativeRecoveryPage user={user} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/recovery" element={<RecoveryPage user={user} />} />
          <Route path="/recovery/:id" element={<RecoveryPage user={user} />} />
          <Route
            path="/admin/migration"
            element={
              user.role === "owner" ? (
                <MigrationPage user={user} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/" element={<Discover />} />
          <Route
            path="/catalog/:kind/:id"
            element={<CatalogPage user={user} />}
          />
          <Route path="/requests" element={<RequestsPage user={user} />} />
          <Route path="/media/:id" element={<MediaPage user={user} />} />
          <Route path="/activity" element={<ActivityPage />} />
          <Route path="/removals" element={<RemovalsPage user={user} />} />
          <Route
            path="/notifications"
            element={<NotificationsPage user={user} />}
          />
          <Route
            path="/notifications/email"
            element={<NotificationCallback user={user} channel="email" />}
          />
          <Route
            path="/notifications/discord"
            element={<NotificationCallback user={user} channel="discord" />}
          />
          <Route
            path="/admin"
            element={
              user.role === "owner" ? (
                <AdminPage user={user} />
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        <footer className="page-footer">
          <span>Good stories. Less housekeeping.</span>
          <span>Powered by your Plex library</span>
        </footer>
      </main>
    </div>
  );
}
