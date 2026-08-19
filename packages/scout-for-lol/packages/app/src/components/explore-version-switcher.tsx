import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ExploreMessage } from "@scout-for-lol/data";
import { IconButton } from "@scout-for-lol/design-system/components/button";

/** Turn navigation for an edited or regenerated question or answer. */
export function ExploreVersionSwitcher(props: {
  message: ExploreMessage;
  onSelectVersion: ((messageId: string) => void) | undefined;
}) {
  const { message, onSelectVersion } = props;
  if (onSelectVersion === undefined || message.versionCount < 2) {
    return null;
  }
  const previous = message.siblingIds[message.versionIndex - 1];
  const next = message.siblingIds[message.versionIndex + 1];
  return (
    <span className="flex items-center gap-0.5 rounded-md border border-scout-border px-1 text-xs">
      <IconButton
        label="Previous version"
        size="icon-sm"
        variant="ghost"
        title="Previous version"
        disabled={previous === undefined}
        onClick={() => {
          if (previous !== undefined) {
            onSelectVersion(previous);
          }
        }}
      >
        <ChevronLeft className="size-3.5" />
      </IconButton>
      <span className="tabular-nums">
        {message.versionIndex + 1}/{message.versionCount}
      </span>
      <IconButton
        label="Next version"
        size="icon-sm"
        variant="ghost"
        title="Next version"
        disabled={next === undefined}
        onClick={() => {
          if (next !== undefined) {
            onSelectVersion(next);
          }
        }}
      >
        <ChevronRight className="size-3.5" />
      </IconButton>
    </span>
  );
}
