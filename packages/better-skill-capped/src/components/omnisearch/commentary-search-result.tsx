import { roleToString } from "#src/model/role";
import React from "react";
import { getStreamUrl } from "#src/utils/url-utilities";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faCloudDownloadAlt } from "@fortawesome/free-solid-svg-icons";
import type { Commentary } from "#src/model/commentary";
import { ToggleBookmarkButton } from "#src/components/bookmark-toggle-button";
import { ToggleWatchStatusButton } from "#src/components/toggle-watch-status-button";
import type { Bookmarkable } from "#src/model/bookmark";
import type { Watchable } from "#src/model/watch-status";

export type CommentarySearchResultProps = {
  commentary: Commentary;
  matchedStrings: string[];
  isBookmarked: boolean;
  isWatched: boolean;
  onToggleBookmark: (item: Bookmarkable) => void;
  onToggleWatchStatus: (item: Watchable) => void;
  isDownloadEnabled: boolean;
};

export function CommentarySearchResult(
  props: CommentarySearchResultProps,
): React.ReactElement {
  const { commentary, isDownloadEnabled } = props;
  const {
    role,
    uuid,
    skillCappedUrl,
    releaseDate,
    staff,
    champion,
    opponent,
    kills,
    deaths,
    assists,
    gameLengthInMinutes,
    carry,
    type,
  } = commentary;

  const buttonProps = {
    ...props,
    item: commentary,
  };

  return (
    <div key={uuid} className="box">
      <div className="box-content">
        <div className="columns is-multiline">
          <div className="column 7">
            <h3 className="title is-5">
              <a href={skillCappedUrl}>
                {champion} vs {opponent}
              </a>
            </h3>
            <div className="tags">
              <span className="tag is-primary">Content Type: Commentary</span>
              <span className="tag is-primary is-light">
                Role: {roleToString(role)}
              </span>
              <span
                className="tag is-primary is-light"
                title={releaseDate.toLocaleString()}
              >
                Released: {releaseDate.toLocaleDateString()}
              </span>
              <span className="tag">Player: {staff}</span>
              <span className="tag">
                K/D/A: {kills}/{deaths}/{assists}
              </span>
              <span className="tag">
                Game Length: {gameLengthInMinutes} minutes
              </span>
              <span className="tag">Carry Amount: {carry}</span>
              <span className="tag">Account Type: {type}</span>
            </div>
          </div>
          <div className="column is-5">
            <figure className="image is-16by9">
              <img
                src={commentary.imageUrl}
                alt="Video thumbnail"
                className="thumbnail"
              />
            </figure>
          </div>
          <div className="column is-12">
            <div className="buttons">
              <ToggleBookmarkButton {...buttonProps} />
              <ToggleWatchStatusButton {...buttonProps} />
              {isDownloadEnabled && (
                <a
                  href={getStreamUrl(commentary)}
                  className="button bookmark is-small"
                >
                  <span className="icon is-small">
                    <FontAwesomeIcon icon={faCloudDownloadAlt} />
                  </span>
                  <span>Download</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
