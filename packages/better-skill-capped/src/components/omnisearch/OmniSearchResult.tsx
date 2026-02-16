import React from "react";
import { Bookmarkable } from "../../model/Bookmark";
import { CourseSearchResult } from "./CourseSearchResult";
import { Watchable } from "../../model/WatchStatus";
import { VideoSearchResult } from "./VideoSearchResult";
import OmniSearchable from "./OmniSearchable";
import { isCourse } from "../../model/Course";
import { isVideo, Video } from "../../model/Video";
import { Commentary, isCommentary } from "../../model/Commentary";
import { CommentarySearchResult } from "./CommentarySearchResult";

export interface OmniSearchResultProps {
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
    const video = item as Video;
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
    const commentary = item as Commentary;
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
