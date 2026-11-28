import { useMemo, useRef, useState } from "react";
import {
  contains,
  denormalizeInRect,
  normalizeInRect,
} from "#client/lib/geometry.ts";
import { TimeStrip } from "./time-strip.tsx";
import {
  contentFileUrl,
  type AnchorAdapter,
  type ViewerProps,
} from "./types.ts";
import { useAdapterRegistration } from "./use-adapter-registration.ts";

/** A pin shows on the video only this close to its moment. */
const SHOW_WITHIN_SECONDS = 1;

export function VideoViewer({
  artifact,
  version,
  mode,
  review,
  adapterRef,
  onViewChange,
}: ViewerProps): React.JSX.Element {
  const ref = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const src = contentFileUrl(version, version.entryPath);

  const adapter = useMemo<AnchorAdapter>(
    () => ({
      toAnchor(point) {
        const video = ref.current;
        if (video === null) return null;
        const rect = video.getBoundingClientRect();
        if (!contains(rect, point)) return null;
        const unit = normalizeInRect(rect, point);
        return unit === null
          ? null
          : { type: "time", t: video.currentTime, x: unit.x, y: unit.y };
      },
      toClient(anchor) {
        const video = ref.current;
        if (
          video === null ||
          anchor.type !== "time" ||
          anchor.x === undefined ||
          anchor.y === undefined ||
          Math.abs(video.currentTime - anchor.t) > SHOW_WITHIN_SECONDS
        )
          return null;
        return denormalizeInRect(video.getBoundingClientRect(), {
          x: anchor.x,
          y: anchor.y,
        });
      },
      reveal(anchor) {
        const video = ref.current;
        if (video !== null && anchor.type === "time") {
          video.pause();
          video.currentTime = anchor.t;
        }
      },
    }),
    [],
  );

  useAdapterRegistration(adapterRef, adapter, onViewChange);

  if (src === null)
    return <p className="ar-note">This version’s files were deleted.</p>;

  return (
    <div className="ar-video" data-mode={mode}>
      <video
        ref={ref}
        className="ar-video-el"
        src={src}
        controls
        preload="metadata"
        playsInline
        aria-label={artifact.title}
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration);
          onViewChange();
        }}
        onTimeUpdate={onViewChange}
        onSeeked={onViewChange}
      />
      {review === null ? null : (
        <TimeStrip
          pins={review.pins}
          duration={duration}
          selectedId={review.selectedId}
          onSelect={review.onSelect}
          onSeek={(seconds) => {
            adapter.reveal?.({ type: "time", t: seconds });
          }}
        />
      )}
    </div>
  );
}
