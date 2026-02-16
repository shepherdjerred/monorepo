import React from "react";
import type { Bookmarkable } from "@shepherdjerred/better-skill-capped/model/Bookmark";
import { CourseSearchResult } from "./CourseSearchResult";
import type { Watchable } from "@shepherdjerred/better-skill-capped/model/WatchStatus";
import { VideoSearchResult } from "./VideoSearchResult";
import type OmniSearchable from "./OmniSearchable";
import { isCourse } from "@shepherdjerred/better-skill-capped/model/Course";
import type { Video } from "@shepherdjerred/better-skill-capped/model/Video";
import { isVideo } from "@shepherdjerred/better-skill-capped/model/Video";
import type { Commentary} from "@shepherdjerred/better-skill-capped/model/Commentary";
import { isCommentary } from "@shepherdjerred/better-skill-capped/model/Commentary";
import { CommentarySearchResult } from "./CommentarySearchResult";

export type OmniSearchResultProps = {
  item: OmniSearchable;
  matchedStrings: string[];
  isWatched: (item: Watchable) => boolean;
  isBookmarked: (item: Bookmarkable) => boolean;
  onToggleBookmark: (item: Bookmarkable) => void;
  onToggleWatchStatus: (item: Watchable) => void;
  isDownloadEnabled: boolean;
}

export function OmniSearchResult({
  item,
  isWatched,
  isBookmarked,
  onToggleWatchStatus,
  onToggleBookmark,
  matchedStrings,
  isDownloadEnabled,
}: OmniSearchResultProps): React.ReactElement {
  if (isCourse(item)) {
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
        isBookmarked={(item: Bookmarkable) => isBookmarked(item)}
        onToggleWatchStatus={onToggleWatchStatus}
        isWatched={(item: Watchable) => isWatched(item)}
        isDownloadEnabled={isDownloadEnabled}
      />
    );
  } else if (isVideo(item)) {
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
  } else if (isCommentary(item)) {
    const commentary = item;
    return (
      <CommentarySearchResult
        key={commentary.uuid}
        commentary={item}
        isBookmarked={isBookmarked(commentary)}
        isWatched={isWatched(item)}
        onToggleBookmark={onToggleBookmark}
        onToggleWatchStatus={onToggleWatchStatus}
        matchedStrings={matchedStrings}
        isDownloadEnabled={isDownloadEnabled}
      />
    );
  }

  return <></>;
}
