import type { Video } from "#src/model/video";
import type { Course } from "#src/model/course";
import Highlighter from "react-highlight-words";
import React from "react";
import { getCourseVideoUrl, getStreamUrl } from "#src/utils/url-utilities";
import type { Bookmarkable } from "#src/model/bookmark";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faBookmark,
  faCloudDownloadAlt,
  faEye,
  faEyeSlash,
} from "@fortawesome/free-solid-svg-icons";
import type { Watchable } from "#src/model/watch-status";
import classNames from "classnames";

export type SearchResultVideoProps = {
  matchedStrings: string[];
  course: Course;
  video: Video;
  onToggleWatchStatus: (item: Watchable) => void;
  onToggleBookmark: (item: Bookmarkable) => void;
  isWatched: boolean;
  isBookmarked: boolean;
  isDownloadEnabled: boolean;
};

export function CourseSearchResultVideo(
  props: SearchResultVideoProps,
): React.ReactElement {
  const {
    course,
    video,
    matchedStrings,
    isWatched,
    isBookmarked,
    isDownloadEnabled,
  } = props;
  // TODO: use alt title from course video
  const { title } = video;

  const link = getCourseVideoUrl(video, course);

  const bookmarkHint = isBookmarked ? "Unbookmark" : "Bookmark";
  const watchToggleIcon = isWatched ? faEyeSlash : faEye;
  const watchToggleHint = isWatched ? "Mark as unwatched" : "Watch as watched";
  const textStyle = isWatched ? "has-text-grey-lighter" : "";

  return (
    <li>
      <a href={link} className={textStyle}>
        <Highlighter
          searchWords={matchedStrings}
          textToHighlight={title}
          autoEscape={true}
        />
      </a>{" "}
      <button
        onClick={() => {
          props.onToggleBookmark(video);
        }}
        className={classNames(
          "video-watched-button tag is-small is-outlined is-inverted is-rounded",
          {
            "is-warning": isBookmarked,
          },
        )}
        title={bookmarkHint}
      >
        <FontAwesomeIcon icon={faBookmark} />
      </button>
      <button
        onClick={() => {
          props.onToggleWatchStatus(video);
        }}
        className="video-watched-button tag is-small is-outlined is-inverted is-rounded"
        title={watchToggleHint}
      >
        <FontAwesomeIcon icon={watchToggleIcon} />
      </button>
      {isDownloadEnabled && (
        <a
          href={getStreamUrl(video)}
          className="video-watched-button tag is-small is-outlined is-inverted is-rounded"
          title="Download video stream"
        >
          <FontAwesomeIcon icon={faCloudDownloadAlt} />
        </a>
      )}
    </li>
  );
}
