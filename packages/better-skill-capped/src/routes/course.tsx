import React from "react";
import { createRoute } from "@tanstack/react-router";
import { roleDisplayName } from "#src/model/role";
import { useContent } from "#src/hooks/use-content";
import { useBookmarks } from "#src/hooks/use-bookmarks";
import { useWatchStatus } from "#src/hooks/use-watch-status";
import { useDownloadEnabled } from "#src/hooks/use-download-enabled";
import { CourseSearchResultVideo } from "#src/components/omnisearch/course-search-result-video";
import { ToggleBookmarkButton } from "#src/components/bookmark-toggle-button";
import { ToggleWatchStatusButton } from "#src/components/toggle-watch-status-button";
import { Container } from "#src/components/container";
import { NotFound, rootRoute } from "./root.tsx";

function CoursePage(): React.ReactElement {
  const { courseUuid } = courseRoute.useParams();
  const { content, isLoading } = useContent();
  const { isBookmarked, toggle: toggleBookmark } = useBookmarks();
  const { isWatched, toggle: toggleWatchStatus } = useWatchStatus();
  const isDownloadEnabled = useDownloadEnabled();

  if (content === undefined) {
    return (
      <Container>
        {isLoading ? (
          <progress className="progress is-small is-primary" max="100" />
        ) : (
          <div className="notification is-danger">
            Content failed to load. Try refreshing the page.
          </div>
        )}
      </Container>
    );
  }

  const course = content.courses.find(
    (candidate) => candidate.uuid === courseUuid,
  );
  if (course === undefined) {
    return <NotFound />;
  }

  return (
    <Container>
      <div className="box">
        <div className="box-content">
          <div className="columns is-multiline">
            <div className="column is-7">
              <h1 className="title is-4">{course.title}</h1>
              <div className="tags">
                <span className="tag is-primary is-light">
                  Role: {roleDisplayName(course.role)}
                </span>
                <span
                  className="tag is-primary is-light"
                  title={course.releaseDate.toLocaleString()}
                >
                  Released: {course.releaseDate.toLocaleDateString()}
                </span>
                <span className="tag">{course.videos.length} videos</span>
              </div>
              {course.description !== undefined && <p>{course.description}</p>}
            </div>
            <div className="column is-5">
              <figure className="image is-16by9">
                <img
                  src={course.image}
                  alt="Course thumbnail"
                  className="thumbnail"
                />
              </figure>
            </div>
            <div className="column is-12">
              <ol>
                {course.videos.map((courseVideo) => (
                  <CourseSearchResultVideo
                    key={courseVideo.video.uuid}
                    course={course}
                    video={courseVideo.video}
                    matchedStrings={[]}
                    isWatched={isWatched(courseVideo.video)}
                    isBookmarked={isBookmarked(courseVideo.video)}
                    onToggleBookmark={toggleBookmark}
                    onToggleWatchStatus={toggleWatchStatus}
                    isDownloadEnabled={isDownloadEnabled}
                  />
                ))}
              </ol>
            </div>
            <div className="column is-12">
              <div className="buttons">
                <ToggleBookmarkButton
                  item={course}
                  isBookmarked={isBookmarked(course)}
                  onToggleBookmark={toggleBookmark}
                />
                <ToggleWatchStatusButton
                  item={course}
                  isWatched={isWatched(course)}
                  onToggleWatchStatus={toggleWatchStatus}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </Container>
  );
}

export const courseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/course/$courseUuid",
  component: CoursePage,
});
