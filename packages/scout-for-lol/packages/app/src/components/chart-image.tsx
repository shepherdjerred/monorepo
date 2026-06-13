import { useEffect, useState } from "react";

/**
 * Renders a server-generated chart PNG fetched with the session cookie.
 *
 * The chart endpoints return 404 when no image exists yet (e.g. a competition
 * whose line chart needs more snapshots, or S3 not configured). Fetching the
 * bytes ourselves lets us render nothing in that case instead of a broken
 * image icon — and avoids attaching an `onError` handler to a non-interactive
 * `<img>`.
 */
export function ChartImage(props: { src: string; alt: string }) {
  const { src, alt } = props;
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;

    async function load(): Promise<void> {
      try {
        const response = await fetch(src, { credentials: "include" });
        if (!response.ok) {
          return;
        }
        const blob = await response.blob();
        if (cancelled) {
          return;
        }
        created = URL.createObjectURL(blob);
        setObjectUrl(created);
      } catch {
        // Network failure — leave the chart unrendered rather than showing a
        // broken image; the standings table above already conveys the data.
        setObjectUrl(null);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (created !== null) {
        URL.revokeObjectURL(created);
      }
    };
  }, [src]);

  if (objectUrl === null) {
    return null;
  }
  return (
    <img
      src={objectUrl}
      alt={alt}
      className="w-full rounded-md border border-border"
    />
  );
}
