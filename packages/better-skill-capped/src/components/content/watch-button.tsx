import React from "react";
import { Eye, EyeOff } from "lucide-react";
import type { ContentItem } from "#src/model/content";
import { Button } from "#components/ui/button";

export type WatchButtonProps = {
  item: ContentItem;
  isWatched: boolean;
  onToggle: (item: ContentItem) => void;
};

export function WatchButton({
  item,
  isWatched,
  onToggle,
}: WatchButtonProps): React.ReactElement {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        onToggle(item);
      }}
    >
      {isWatched ? <EyeOff /> : <Eye />}
      {isWatched ? "Mark as unwatched" : "Mark as watched"}
    </Button>
  );
}
