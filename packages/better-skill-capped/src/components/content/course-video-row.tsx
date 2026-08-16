import React from "react";
import Highlighter from "react-highlight-words";
import { Bookmark, Eye, EyeOff } from "lucide-react";
import type { Course, Video } from "#src/model/content";
import { getCourseVideoUrl } from "#src/utils/url-utilities";
import { Button } from "#components/ui/button";
import { DownloadLink } from "./download-link.tsx";
import { cn } from "#lib/utils";

export type CourseVideoRowProps = {
  course: Course;
  video: Video;
  alternateTitle?: string | undefined;
  matchedStrings: string[];
  isWatched: boolean;
  isBookmarked: boolean;
  onToggleBookmark: (item: Video) => void;
  onToggleWatchStatus: (item: Video) => void;
};

export function CourseVideoRow({
  course,
  video,
  alternateTitle,
  matchedStrings,
  isWatched,
  isBookmarked,
  onToggleBookmark,
  onToggleWatchStatus,
}: CourseVideoRowProps): React.ReactElement {
  return (
    <li className="flex items-center gap-2 py-0.5">
      <a
        href={getCourseVideoUrl(video, course)}
        className={cn(
          "truncate underline-offset-2 hover:underline",
          isWatched && "text-muted-foreground line-through decoration-1",
        )}
      >
        <Highlighter
          searchWords={matchedStrings}
          textToHighlight={alternateTitle ?? video.title}
          autoEscape={true}
        />
      </a>
      <span className="flex shrink-0 items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          title={isBookmarked ? "Unbookmark" : "Bookmark"}
          onClick={() => {
            onToggleBookmark(video);
          }}
        >
          <Bookmark
            className={cn(isBookmarked && "fill-amber-400 text-amber-400")}
          />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title={isWatched ? "Mark as unwatched" : "Mark as watched"}
          onClick={() => {
            onToggleWatchStatus(video);
          }}
        >
          {isWatched ? <EyeOff /> : <Eye />}
        </Button>
        <DownloadLink item={video} iconOnly />
      </span>
    </li>
  );
}
