import type { Course } from "#src/model/course";
import React from "react";
import Highlighter from "react-highlight-words";
import "./CourseSearchResult.css";
import type { Watchable } from "#src/model/watch-status";
import type { FuseSearchResult } from "./search/fuse-search.tsx";
import { CourseSearchResultVideo } from "./course-search-result-video.tsx";
import { roleToString } from "#src/model/role";
import { ToggleBookmarkButton } from "#src/components/bookmark-toggle-button";
import { ToggleWatchStatusButton } from "#src/components/toggle-watch-status-button";
import type { Bookmarkable } from "#src/model/bookmark";

export type CourseSearchResultProps = {
  result: FuseSearchResult<Course>;
  onToggleBookmark: (item: Bookmarkable) => void;
  isBookmarked: (item: Bookmarkable) => boolean;
  isWatched: (item: Watchable) => boolean;
  onToggleWatchStatus: (item: Watchable) => void;
  isDownloadEnabled: boolean;
};

export function CourseSearchResult(
  props: CourseSearchResultProps,
): React.ReactElement {
  const {
    result,
    isWatched,
    onToggleWatchStatus,
    onToggleBookmark,
    isBookmarked,
    isDownloadEnabled,
  } = props;
  const { matchedStrings, item: course } = result;

  const videos = course.videos.map(({ video }) => {
    return (
      <CourseSearchResultVideo
        key={video.uuid}
        matchedStrings={matchedStrings}
        course={course}
        video={video}
        onToggleWatchStatus={onToggleWatchStatus}
        isWatched={isWatched(video)}
        onToggleBookmark={onToggleBookmark}
        isBookmarked={isBookmarked(video)}
        isDownloadEnabled={isDownloadEnabled}
      />
    );
  });

  return (
    <div key={course.uuid} className="box">
      <div className="box-content">
        <div className="columns is-multiline">
          <div className="column is-7">
            <h3 className="title">
              <Highlighter
                searchWords={props.result.matchedStrings}
                textToHighlight={course.title}
                autoEscape={true}
              />
            </h3>
            <p>{course.description}</p>
            <div className="tags">
              <span className="tag is-primary">Content Type: Course</span>
              <span className="tag is-primary is-light">
                Role: {roleToString(props.result.item.role)}
              </span>
              <span
                className="tag is-primary is-light"
                title={props.result.item.releaseDate.toLocaleString()}
              >
                Released: {props.result.item.releaseDate.toLocaleDateString()}
              </span>
            </div>
            <div>
              <ol>{videos}</ol>
            </div>
          </div>
          <div className="column is-5">
            <figure className="image">
              <img
                src={course.image}
                alt="Video thumbnail"
                className="thumbnail"
                onError={(e) => {
                  // Fallback to first video's thumbnail if course image fails
                  if (course.videos.length > 0) {
                    e.currentTarget.src = course.videos[0].video.imageUrl;
                  }
                }}
              />
            </figure>
          </div>
          <div className="column is-12">
            <div className="buttons">
              <ToggleBookmarkButton
                item={course}
                isBookmarked={isBookmarked(course)}
                onToggleBookmark={onToggleBookmark}
              />
              <ToggleWatchStatusButton
                item={course}
                isWatched={isWatched(course)}
                onToggleWatchStatus={onToggleWatchStatus}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
