import React from "react";
import { CloudDownload } from "lucide-react";
import type { Commentary, Video } from "#src/model/content";
import { getStreamUrl } from "#src/utils/url-utilities";
import { useDownloadEnabled } from "#src/hooks/use-download-enabled";
import { buttonVariants } from "#components/ui/button";

export type DownloadLinkProps = {
  item: Video | Commentary;
  /** Compact icon-only rendering for inline rows. */
  iconOnly?: boolean;
};

/**
 * Renders nothing unless the hidden `localStorage.download` flag is set.
 */
export function DownloadLink({
  item,
  iconOnly = false,
}: DownloadLinkProps): React.ReactElement | null {
  const isDownloadEnabled = useDownloadEnabled();
  if (!isDownloadEnabled) {
    return null;
  }

  return (
    <a
      href={getStreamUrl(item)}
      title="Download video stream"
      className={buttonVariants({
        variant: "outline",
        size: iconOnly ? "icon-sm" : "sm",
      })}
    >
      <CloudDownload />
      {!iconOnly && "Download"}
    </a>
  );
}
