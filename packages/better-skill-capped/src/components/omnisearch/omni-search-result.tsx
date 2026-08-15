import React from "react";
import type { Bookmarkable } from "#src/model/bookmark";
import { CourseSearchResult } from "./course-search-result.tsx";
import type { Watchable } from "#src/model/watch-status";
import { VideoSearchResult } from "./video-search-result.tsx";
import type { OmniSearchable } from "./omni-searchable.ts";
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
  switch (item.kind) {
    case "course": {
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
    }
    case "commentary": {
      return (
        <CommentarySearchResult
          key={item.uuid}
          commentary={item}
          isBookmarked={isBookmarked(item)}
          isWatched={isWatched(item)}
          onToggleBookmark={onToggleBookmark}
          onToggleWatchStatus={onToggleWatchStatus}
          matchedStrings={matchedStrings}
          isDownloadEnabled={isDownloadEnabled}
        />
      );
    }
    case "video": {
      return (
        <VideoSearchResult
          key={item.uuid}
          video={item}
          isBookmarked={isBookmarked(item)}
          isWatched={isWatched(item)}
          onToggleBookmark={onToggleBookmark}
          onToggleWatchStatus={onToggleWatchStatus}
          matchedStrings={matchedStrings}
          isDownloadEnabled={isDownloadEnabled}
        />
      );
    }
    default: {
      return item satisfies never;
    }
  }
}
