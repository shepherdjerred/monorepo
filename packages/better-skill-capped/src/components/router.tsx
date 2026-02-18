import { BrowserRouter, Route, Routes } from "react-router-dom";
import React from "react";
import { Footer } from "./footer.tsx";
import "./Wrapper.css";
import { Color, Hero, Size } from "./hero.tsx";
import type { Bookmark, Bookmarkable } from "#src/model/bookmark";
import type { Watchable, WatchStatus } from "#src/model/watch-status";
import * as Sentry from "@sentry/react";
import type { Content } from "#src/model/content";
import { OmniSearch } from "./omnisearch/omni-search.tsx";
import type OmniSearchable from "./omnisearch/omni-searchable.tsx";

export type RouterProps = {
  content?: Content;
  bookmarks: Bookmark[];
  onToggleBookmark: (item: Bookmarkable) => void;
  watchStatuses: WatchStatus[];
  onToggleWatchStatus: (item: Watchable) => void;
  isBookmarked: (item: Bookmarkable) => boolean;
  isWatched: (item: Watchable) => boolean;
  isDownloadEnabled: boolean;
  isTipsModalVisible: boolean;
  onToggleTipsModal: () => void;
};

export function Router(props: RouterProps): React.ReactElement {
  const {
    content,
    onToggleBookmark,
    onToggleWatchStatus,
    isBookmarked,
    isWatched,
    isDownloadEnabled,
  } = props;
  const courses = content?.courses ?? [];
  const videos = content?.videos ?? [];
  const commentaries = content?.commentaries ?? [];
  const items: OmniSearchable[] = [...courses, ...videos, ...commentaries].sort(
    (left, right) => right.releaseDate.getTime() - left.releaseDate.getTime(),
  );

  return (
    <React.Fragment>
      <div className="page-wrapper">
        <div className="content-wrapper">
          <BrowserRouter>
            <Sentry.ErrorBoundary
              fallback={
                <Hero
                  title="Something went wrong"
                  color={Color.RED}
                  size={Size.FULL}
                />
              }
              showDialog={true}
            >
              <div>
                <Routes>
                  <Route
                    path="/"
                    element={
                      <OmniSearch
                        items={items}
                        onToggleBookmark={onToggleBookmark}
                        onToggleWatchStatus={onToggleWatchStatus}
                        isWatched={isWatched}
                        isBookmarked={isBookmarked}
                        isDownloadEnabled={isDownloadEnabled}
                        onToggleTipsModal={props.onToggleTipsModal}
                        isTipsModalVisible={props.isTipsModalVisible}
                      />
                    }
                  />
                  <Route
                    path="*"
                    element={
                      <Hero
                        title="Page Not Found"
                        subtitle="This page doesn't exist"
                        size={Size.FULL}
                        color={Color.RED}
                      />
                    }
                  />
                </Routes>
              </div>
            </Sentry.ErrorBoundary>
          </BrowserRouter>
        </div>
        <Footer />
      </div>
    </React.Fragment>
  );
}
