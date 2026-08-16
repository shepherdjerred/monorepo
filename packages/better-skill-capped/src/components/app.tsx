import React, { useState } from "react";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import * as Sentry from "@sentry/react";
import { Router } from "./router.tsx";
import { Color, Hero, Size } from "./hero.tsx";
import { persistOptions, queryClient } from "#src/lib/query-client";
import { useContent } from "#src/hooks/use-content";
import { useBookmarks } from "#src/hooks/use-bookmarks";
import { useWatchStatus } from "#src/hooks/use-watch-status";
import { useDownloadEnabled } from "#src/hooks/use-download-enabled";

// Workaround: @sentry/react ErrorBoundary types are incompatible with React 19's
// stricter class component typing. The component works at runtime.
// eslint-disable-next-line custom-rules/no-type-assertions -- Sentry ErrorBoundary class types incompatible with React 19
const ErrorBoundary = Sentry.ErrorBoundary as unknown as React.ComponentType<
  React.PropsWithChildren<{ fallback: React.ReactNode; showDialog?: boolean }>
>;

export default function App(): React.ReactElement {
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={persistOptions}
    >
      <AppContent />
    </PersistQueryClientProvider>
  );
}

function AppContent(): React.ReactElement {
  const { content } = useContent();
  const { bookmarks, isBookmarked, toggle: toggleBookmark } = useBookmarks();
  const {
    watchStatuses,
    isWatched,
    toggle: toggleWatchStatus,
  } = useWatchStatus();
  const isDownloadEnabled = useDownloadEnabled();
  const [isTipsModalVisible, setTipsModalVisible] = useState(false);

  return (
    <ErrorBoundary
      fallback={
        <Hero title="Something went wrong" color={Color.RED} size={Size.FULL} />
      }
      showDialog={true}
    >
      <Router
        content={content}
        bookmarks={bookmarks}
        onToggleBookmark={toggleBookmark}
        watchStatuses={watchStatuses}
        onToggleWatchStatus={toggleWatchStatus}
        isBookmarked={isBookmarked}
        isWatched={isWatched}
        isDownloadEnabled={isDownloadEnabled}
        isTipsModalVisible={isTipsModalVisible}
        onToggleTipsModal={() => {
          setTipsModalVisible((visible) => !visible);
        }}
      />
    </ErrorBoundary>
  );
}
