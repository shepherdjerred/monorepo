import "asciinema-player/dist/bundle/asciinema-player.css";
import { create, type Player } from "asciinema-player";
import { useEffect, useMemo, useRef, useState } from "react";
import { contains } from "#client/lib/geometry.ts";
import { TimeStrip } from "./time-strip.tsx";
import {
  contentFileUrl,
  type AnchorAdapter,
  type ViewerProps,
} from "./types.ts";
import { useAdapterRegistration } from "./use-adapter-registration.ts";

export function CastViewer({
  version,
  mode,
  review,
  adapterRef,
  onViewChange,
}: ViewerProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<Player | null>(null);
  const [duration, setDuration] = useState(0);
  const src = contentFileUrl(version, version.entryPath);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null || src === null) return;
    const player = create({ url: src }, host, {
      preload: true,
      fit: "width",
      idleTimeLimit: 2,
      controls: true,
    });
    playerRef.current = player;
    // The duration is known once the recording loaded.
    const poll = setInterval(() => {
      const length = player.getDuration();
      if (length !== undefined) {
        setDuration(length);
        clearInterval(poll);
      }
    }, 400);
    return () => {
      clearInterval(poll);
      player.dispose();
      playerRef.current = null;
    };
  }, [src]);

  const adapter = useMemo<AnchorAdapter>(
    () => ({
      toAnchor(point) {
        const host = hostRef.current;
        const player = playerRef.current;
        if (host === null || player === null) return null;
        return contains(host.getBoundingClientRect(), point)
          ? { type: "time", t: player.getCurrentTime() }
          : null;
      },
      // A time-only thread has no place on the terminal; the strip shows it.
      toClient: () => null,
      reveal(anchor) {
        if (anchor.type === "time") void playerRef.current?.seek(anchor.t);
      },
    }),
    [],
  );

  useAdapterRegistration(adapterRef, adapter, onViewChange);

  if (src === null)
    return <p className="ar-note">This version’s files were deleted.</p>;

  return (
    <div className="ar-cast" data-mode={mode}>
      <div ref={hostRef} className="ar-cast-player" data-testid="cast-player" />
      {review === null ? null : (
        <TimeStrip
          pins={review.pins}
          duration={duration}
          selectedId={review.selectedId}
          onSelect={review.onSelect}
          onSeek={(seconds) => {
            void playerRef.current?.seek(seconds);
          }}
        />
      )}
    </div>
  );
}
