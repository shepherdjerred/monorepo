import React from "react";
import { createRoute } from "@tanstack/react-router";
import { roleDisplayName } from "#src/model/role";
import { useContent } from "#src/hooks/use-content";
import { useBookmarks } from "#src/hooks/use-bookmarks";
import { useWatchStatus } from "#src/hooks/use-watch-status";
import { CourseVideoRow } from "#src/components/content/course-video-row";
import { BookmarkButton } from "#src/components/content/bookmark-button";
import { WatchButton } from "#src/components/content/watch-button";
import { Badge } from "#components/ui/badge";
import { Card, CardContent } from "#components/ui/card";
import { NotFound, rootRoute } from "./root.tsx";

function CoursePage(): React.ReactElement {
  const { courseUuid } = courseRoute.useParams();
  const { content, isLoading } = useContent();
  const { isBookmarked, toggle: toggleBookmark } = useBookmarks();
  const { isWatched, toggle: toggleWatchStatus } = useWatchStatus();

  if (content === undefined) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-10 text-center text-muted-foreground">
        {isLoading
          ? "Loading…"
          : "Content failed to load. Try refreshing the page."}
      </div>
    );
  }

  const course = content.courses.find(
    (candidate) => candidate.uuid === courseUuid,
  );
  if (course === undefined) {
    return <NotFound />;
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Card>
        <CardContent className="grid gap-6 sm:grid-cols-[1fr_18rem]">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">
              {course.title}
            </h1>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge variant="secondary">{roleDisplayName(course.role)}</Badge>
              <Badge
                variant="outline"
                title={course.releaseDate.toLocaleString()}
              >
                Released {course.releaseDate.toLocaleDateString()}
              </Badge>
              <Badge variant="outline">{course.videos.length} videos</Badge>
            </div>
            {course.description !== undefined && (
              <p className="mt-3 text-muted-foreground">{course.description}</p>
            )}
            <ol className="mt-4 list-inside list-decimal">
              {course.videos.map((courseVideo) => (
                <CourseVideoRow
                  key={courseVideo.video.uuid}
                  course={course}
                  video={courseVideo.video}
                  alternateTitle={courseVideo.alternateTitle}
                  matchedStrings={[]}
                  isWatched={isWatched(courseVideo.video)}
                  isBookmarked={isBookmarked(courseVideo.video)}
                  onToggleBookmark={toggleBookmark}
                  onToggleWatchStatus={toggleWatchStatus}
                />
              ))}
            </ol>
            <div className="mt-4 flex flex-wrap gap-2">
              <BookmarkButton
                item={course}
                isBookmarked={isBookmarked(course)}
                onToggle={toggleBookmark}
              />
              <WatchButton
                item={course}
                isWatched={isWatched(course)}
                onToggle={toggleWatchStatus}
              />
            </div>
          </div>
          <img
            src={course.image}
            alt="Course thumbnail"
            className="aspect-video w-full rounded-lg border object-cover"
          />
        </CardContent>
      </Card>
    </div>
  );
}

export const courseRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/course/$courseUuid",
  component: CoursePage,
});
