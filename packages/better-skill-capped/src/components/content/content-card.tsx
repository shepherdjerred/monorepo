import React from "react";
import Highlighter from "react-highlight-words";
import { Link } from "@tanstack/react-router";
import type {
  Commentary,
  ContentItem,
  Course,
  Video,
} from "#src/model/content";
import { roleDisplayName } from "#src/model/role";
import { Badge } from "#components/ui/badge";
import { Card, CardContent } from "#components/ui/card";
import { BookmarkButton } from "./bookmark-button.tsx";
import { WatchButton } from "./watch-button.tsx";
import { DownloadLink } from "./download-link.tsx";
import { CourseVideoRow } from "./course-video-row.tsx";
import { CoachAttribution } from "#src/features/commentaries/coach-attribution";
import { CourseBadges } from "#src/features/courses/course-badges";
import { ChampionIcon } from "#src/features/ddragon/champion-icon";

export type ContentCardProps = {
  item: ContentItem;
  matchedStrings: string[];
  isWatched: (item: ContentItem) => boolean;
  isBookmarked: (item: ContentItem) => boolean;
  onToggleBookmark: (item: ContentItem) => void;
  onToggleWatchStatus: (item: ContentItem) => void;
};

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}m${String(seconds).padStart(2, "0")}s`;
}

function Thumbnail({
  src,
  fallbackSrc,
}: {
  src: string;
  fallbackSrc?: string | undefined;
}): React.ReactElement {
  return (
    <img
      src={src}
      alt="Video thumbnail"
      loading="lazy"
      className="aspect-video w-full rounded-lg border object-cover"
      onError={(event) => {
        if (
          fallbackSrc !== undefined &&
          event.currentTarget.src !== fallbackSrc
        ) {
          event.currentTarget.src = fallbackSrc;
        }
      }}
    />
  );
}

function ReleasedBadge({ date }: { date: Date }): React.ReactElement {
  return (
    <Badge variant="outline" title={date.toLocaleString()}>
      Released {date.toLocaleDateString()}
    </Badge>
  );
}

export function ContentCard(props: ContentCardProps): React.ReactElement {
  const { item } = props;
  switch (item.kind) {
    case "video": {
      return <VideoCard {...props} video={item} />;
    }
    case "commentary": {
      return <CommentaryCard {...props} commentary={item} />;
    }
    case "course": {
      return <CourseCard {...props} course={item} />;
    }
    default: {
      // `item` is `never` here; a kind outside the union means a producer
      // broke the discriminated-union contract. Fail at the point of failure.
      throw new Error(
        `Unknown content kind: ${JSON.stringify(item satisfies never)}`,
      );
    }
  }
}

function CardActions({
  item,
  ...props
}: ContentCardProps & { item: ContentItem }): React.ReactElement {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <BookmarkButton
        item={item}
        isBookmarked={props.isBookmarked(item)}
        onToggle={props.onToggleBookmark}
      />
      <WatchButton
        item={item}
        isWatched={props.isWatched(item)}
        onToggle={props.onToggleWatchStatus}
      />
      {(item.kind === "video" || item.kind === "commentary") && (
        <DownloadLink item={item} />
      )}
    </div>
  );
}

function VideoCard(
  props: ContentCardProps & { video: Video },
): React.ReactElement {
  const { video, matchedStrings } = props;
  return (
    <Card className="mb-4">
      <CardContent className="grid gap-4 sm:grid-cols-[1fr_16rem]">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">
            <a
              href={video.skillCappedUrl}
              className="underline-offset-2 hover:underline"
            >
              <Highlighter
                searchWords={matchedStrings}
                textToHighlight={video.title}
                autoEscape={true}
              />
            </a>
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>Video</Badge>
            <Badge variant="secondary">{roleDisplayName(video.role)}</Badge>
            <ReleasedBadge date={video.releaseDate} />
            <Badge variant="outline">
              {formatDuration(video.durationInSeconds)}
            </Badge>
          </div>
          <CardActions {...props} item={video} />
        </div>
        <Thumbnail src={video.imageUrl} />
      </CardContent>
    </Card>
  );
}

function CommentaryCard(
  props: ContentCardProps & { commentary: Commentary },
): React.ReactElement {
  const { commentary } = props;
  return (
    <Card className="mb-4">
      <CardContent className="grid gap-4 sm:grid-cols-[1fr_16rem]">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-lg font-semibold">
            <ChampionIcon name={commentary.champion} />
            <a
              href={commentary.skillCappedUrl}
              className="underline-offset-2 hover:underline"
            >
              {commentary.champion} vs {commentary.opponent}
            </a>
            <ChampionIcon
              name={commentary.opponent}
              className="size-6 rounded opacity-60"
            />
          </h3>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge>Commentary</Badge>
            <Badge variant="secondary">
              {roleDisplayName(commentary.role)}
            </Badge>
            <ReleasedBadge date={commentary.releaseDate} />
            <CoachAttribution name={commentary.staff} />
            <Badge variant="outline">
              K/D/A: {commentary.kills}/{commentary.deaths}/{commentary.assists}
            </Badge>
            {commentary.gameLengthInSeconds !== undefined && (
              <Badge variant="outline">
                Game length: {formatDuration(commentary.gameLengthInSeconds)}
              </Badge>
            )}
            <Badge variant="outline">Carry: {commentary.carry}</Badge>
            <Badge variant="outline">{commentary.type}</Badge>
          </div>
          <CardActions {...props} item={commentary} />
        </div>
        <Thumbnail src={commentary.imageUrl} />
      </CardContent>
    </Card>
  );
}

function CourseCard(
  props: ContentCardProps & { course: Course },
): React.ReactElement {
  const { course, matchedStrings } = props;
  return (
    <Card className="mb-4">
      <CardContent className="grid gap-4 sm:grid-cols-[1fr_16rem]">
        <div className="min-w-0">
          <h3 className="text-lg font-semibold">
            <Link
              to="/course/$courseUuid"
              params={{ courseUuid: course.uuid }}
              className="underline-offset-2 hover:underline"
            >
              <Highlighter
                searchWords={matchedStrings}
                textToHighlight={course.title}
                autoEscape={true}
              />
            </Link>
          </h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>Course</Badge>
            <Badge variant="secondary">{roleDisplayName(course.role)}</Badge>
            <ReleasedBadge date={course.releaseDate} />
            <Badge variant="outline">{course.videos.length} videos</Badge>
          </div>
          <CourseBadges course={course} />
          <ol className="mt-3 list-inside list-decimal text-sm">
            {course.videos.map((courseVideo) => (
              <CourseVideoRow
                key={courseVideo.video.uuid}
                course={course}
                video={courseVideo.video}
                alternateTitle={courseVideo.alternateTitle}
                matchedStrings={matchedStrings}
                isWatched={props.isWatched(courseVideo.video)}
                isBookmarked={props.isBookmarked(courseVideo.video)}
                onToggleBookmark={props.onToggleBookmark}
                onToggleWatchStatus={props.onToggleWatchStatus}
              />
            ))}
          </ol>
          <CardActions {...props} item={course} />
        </div>
        <Thumbnail
          src={course.image}
          fallbackSrc={course.videos[0]?.video.imageUrl}
        />
      </CardContent>
    </Card>
  );
}
