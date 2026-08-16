import React from "react";
import { Bookmark } from "lucide-react";
import type { ContentItem } from "#src/model/content";
import { Button } from "#components/ui/button";
import { cn } from "#lib/utils";

export type BookmarkButtonProps = {
  item: ContentItem;
  isBookmarked: boolean;
  onToggle: (item: ContentItem) => void;
};

export function BookmarkButton({
  item,
  isBookmarked,
  onToggle,
}: BookmarkButtonProps): React.ReactElement {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        onToggle(item);
      }}
    >
      <Bookmark
        className={cn(isBookmarked && "fill-amber-400 text-amber-400")}
      />
      {isBookmarked ? "Unbookmark" : "Bookmark"}
    </Button>
  );
}
