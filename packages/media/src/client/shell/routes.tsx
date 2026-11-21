import { createElement, type ComponentType } from "react";
import { Navigate, useRouteError, type RouteObject } from "react-router";
import type { MediaUser } from "#shared/contract.ts";
import { App } from "#client/app.tsx";
import { CalendarPage } from "#client/calendar/page.tsx";
import { CatalogPage, Discover } from "#client/catalog.tsx";
import { Loading, Notice, PageTitle } from "#client/components.tsx";
import { PlaybackHistoryPage } from "#client/household/playback.tsx";
import { LibraryPage } from "#client/library/page.tsx";
import {
  NotificationsPage,
  RemovalsPage,
  RequestsPage,
} from "#client/lists.tsx";
import { MediaPage } from "#client/media.tsx";
import { MovieHistoryPageV3 } from "#client/movie-history/page.tsx";
import { NotificationCallback } from "#client/preferences.tsx";
import { RecoveryPage } from "#client/recovery/page.tsx";
import { RemovalHistoryPage } from "#client/removal-history/page.tsx";
import { HOME_PATH, MovedTo, OwnerOnly } from "./redirects.tsx";
import { useUser } from "./user.ts";

/** A page that takes the signed-in user, as a route element. */
function withUser(page: ComponentType<{ user: MediaUser }>) {
  return function UserPage() {
    return createElement(page, { user: useUser() });
  };
}

const Library = withUser(LibraryPage);
const Requests = withUser(RequestsPage);
const PlaybackHistory = withUser(PlaybackHistoryPage);
const Removals = withUser(RemovalsPage);
const Catalog = withUser(CatalogPage);
const Media = withUser(MediaPage);
const Notifications = withUser(NotificationsPage);
const Recovery = withUser(RecoveryPage);
const MovieHistory = withUser(MovieHistoryPageV3);

function EmailCallback() {
  return <NotificationCallback user={useUser()} channel="email" />;
}

function DiscordCallback() {
  return <NotificationCallback user={useUser()} channel="discord" />;
}

/** A page that threw, or a part of the client that could not be fetched. */
function RouteError() {
  const error = useRouteError();
  return (
    <>
      <PageTitle title="This page did not load" />
      <Notice error>
        Media could not show this page. Check your connection, then reload.
        {error instanceof Error && <> ({error.message})</>}
      </Notice>
      <div className="action-row">
        <button
          className="button"
          type="button"
          onClick={() => {
            globalThis.location.reload();
          }}
        >
          Reload
        </button>
      </div>
    </>
  );
}

/**
 * The owner's Manage pages. Each is fetched when first opened, so none of
 * this code is in the bundle a household member downloads.
 */
const manageRoutes: RouteObject[] = [
  { index: true, element: <Navigate to="/manage/household" replace /> },
  {
    path: "household",
    lazy: async () => {
      const { HouseholdPage } = await import("#client/manage/household.tsx");
      return { Component: HouseholdPage };
    },
  },
  {
    path: "quality",
    lazy: async () => {
      const { QualityPage } = await import("#client/manage/quality.tsx");
      return { Component: QualityPage };
    },
  },
  {
    path: "subtitles",
    lazy: async () => {
      const { SubtitlesPage } = await import("#client/manage/tools.tsx");
      return { Component: SubtitlesPage };
    },
  },
  {
    path: "subtitles/replacements/:id?",
    lazy: async () => {
      const { SubtitleReplacementPage } =
        await import("#client/subtitle-replacement/page.tsx");
      return { Component: withUser(SubtitleReplacementPage) };
    },
  },
  {
    path: "plex",
    lazy: async () => {
      const { PlexPage } = await import("#client/manage/tools.tsx");
      return { Component: PlexPage };
    },
  },
  {
    path: "numbering",
    lazy: async () => {
      const { NumberingPage } = await import("#client/manage/tools.tsx");
      return { Component: NumberingPage };
    },
  },
  {
    path: "providers",
    lazy: async () => {
      const { ProvidersPage } = await import("#client/manage/tools.tsx");
      return { Component: ProvidersPage };
    },
  },
  {
    path: "activity",
    lazy: async () => {
      const { ActivityPage } = await import("#client/manage/activity.tsx");
      return { Component: ActivityPage };
    },
  },
  {
    path: "recovery",
    lazy: async () => {
      const { RecoveryHubPage } = await import("#client/manage/recovery.tsx");
      return { Component: RecoveryHubPage };
    },
  },
  {
    path: "recovery/native/:id?",
    lazy: async () => {
      const { NativeRecoveryPage } =
        await import("#client/native-recovery/page.tsx");
      return { Component: withUser(NativeRecoveryPage) };
    },
  },
  {
    path: "migration",
    lazy: async () => {
      const { MigrationPage } = await import("#client/migration.tsx");
      return { Component: withUser(MigrationPage) };
    },
  },
  { path: "*", element: <Navigate to="/manage/household" replace /> },
];

/**
 * Addresses from before Manage existed. The server still writes some of
 * them into emails, Discord messages, and OAuth returns, and people have
 * them bookmarked.
 */
const movedRoutes: RouteObject[] = [
  { index: true, element: <MovedTo path={HOME_PATH} /> },
  {
    path: "admin",
    element: <MovedTo path="/manage/household" ownerOnly />,
  },
  {
    path: "admin/migration",
    element: <MovedTo path="/manage/migration" ownerOnly />,
  },
  {
    path: "admin/subtitle-replacements/:id?",
    element: <MovedTo path="/manage/subtitles/replacements/:id?" ownerOnly />,
  },
  {
    path: "recovery/native/:id?",
    element: <MovedTo path="/manage/recovery/native/:id?" ownerOnly />,
  },
  {
    path: "activity",
    element: <MovedTo path="/manage/activity" ownerOnly />,
  },
];

export const routes: RouteObject[] = [
  {
    path: "/",
    // The session gate: the sign-in page, or the shell around an <Outlet />.
    element: <App />,
    children: [
      {
        // Pathless, so an error replaces the page and leaves the shell.
        errorElement: <RouteError />,
        children: [
          { path: "discover", element: <Discover /> },
          { path: "library", element: <Library /> },
          { path: "requests", element: <Requests /> },
          { path: "calendar", element: <CalendarPage /> },
          { path: "history", element: <PlaybackHistory /> },
          { path: "removals", element: <Removals /> },
          { path: "removed", element: <RemovalHistoryPage /> },
          { path: "catalog/:kind/:id", element: <Catalog /> },
          { path: "media/:id", element: <Media /> },
          { path: "notifications", element: <Notifications /> },
          { path: "notifications/email", element: <EmailCallback /> },
          { path: "notifications/discord", element: <DiscordCallback /> },
          { path: "recovery", element: <Recovery /> },
          { path: "recovery/movies/:id", element: <MovieHistory /> },
          { path: "recovery/:id", element: <Recovery /> },
          {
            path: "manage",
            element: <OwnerOnly />,
            children: [
              {
                // Opening a Manage address directly shows the shell while
                // the area's code arrives.
                hydrateFallbackElement: <Loading />,
                lazy: async () => {
                  const { ManageLayout } =
                    await import("#client/manage/layout.tsx");
                  return { Component: ManageLayout };
                },
                children: manageRoutes,
              },
            ],
          },
          ...movedRoutes,
          { path: "*", element: <Navigate to={HOME_PATH} replace /> },
        ],
      },
    ],
  },
];
