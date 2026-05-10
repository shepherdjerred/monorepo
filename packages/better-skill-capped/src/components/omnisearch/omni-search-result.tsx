import React from "react";
import type { Bookmarkable } from "#src/model/bookmark";
import { CourseSearchResult } from "./course-search-result.tsx";
import type { Watchable } from "#src/model/watch-status";
import { VideoSearchResult } from "./video-search-result.tsx";
import type OmniSearchable from "./omni-searchable.tsx";
import { CommentarySearchResult } from "./commentary-search-result.tsx";

export type OmniSearchResultProps = {
  item: OmniSearchable;
  matchedStrings: string[];
  isWatched: (item: Watchable) => boolean;
  isBookmarked: (item: Bookmarkable) => boolean;
  onToggleBookmark: (item: Bookmarkable) => void;
  onToggleWatchStatus: (item: Watchable) => void;
  isDownloadEnabled: boolean;
};

export function OmniSearchResult({
  item,
  isWatched,
  isBookmarked,
  onToggleWatchStatus,
  onToggleBookmark,
  matchedStrings,
  isDownloadEnabled,
}: OmniSearchResultProps): React.ReactElement {
  if ("videos" in item) {
    const result = {
      item,
      matchedStrings: matchedStrings,
    };

    return (
      <CourseSearchResult
        key={item.uuid}
        result={result}
        onToggleBookmark={() => {
          onToggleBookmark(item);
        }}
        isBookmarked={(bookmarkable: Bookmarkable) =>
          isBookmarked(bookmarkable)
        }
        onToggleWatchStatus={onToggleWatchStatus}
        isWatched={(watchable: Watchable) => isWatched(watchable)}
        isDownloadEnabled={isDownloadEnabled}
      />
    );
  } else if ("matchLink" in item) {
    const commentary = item;
    return (
      <CommentarySearchResult
        key={commentary.uuid}
        commentary={commentary}
        isBookmarked={isBookmarked(commentary)}
        isWatched={isWatched(commentary)}
        onToggleBookmark={onToggleBookmark}
        onToggleWatchStatus={onToggleWatchStatus}
        matchedStrings={matchedStrings}
        isDownloadEnabled={isDownloadEnabled}
      />
    );
  } else {
    const video = item;
    return (
      <VideoSearchResult
        key={video.uuid}
        video={video}
        isBookmarked={isBookmarked(video)}
        isWatched={isWatched(video)}
        onToggleBookmark={onToggleBookmark}
        onToggleWatchStatus={onToggleWatchStatus}
        matchedStrings={matchedStrings}
        isDownloadEnabled={isDownloadEnabled}
      />
    );
  }
}
