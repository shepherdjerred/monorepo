import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { ExploreTranscript as Transcript } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { ExploreTranscript } from "#src/components/explore-transcript.tsx";
import { SectionSkeleton } from "#src/components/section-skeleton.tsx";
import { fetchSharedTranscript } from "#src/lib/explore-stream.ts";

/**
 * The read-only view of a shared conversation.
 *
 * Mounted outside RequireSession: a share link has to work for someone with
 * no Scout account, which is the whole point of sharing one. It renders the
 * frozen turns exactly as stored — no queries run here — and offers a sign-in
 * path for a visitor who wants to ask their own questions.
 */
export function ExploreShared() {
  const { shareToken } = useParams();
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Both reset here, not just on success: rendering checks `error` before
    // `transcript`, so an error left over from a previous token would mask the
    // new one permanently, and a transcript left over would briefly show the
    // previous conversation under the new link. The effect re-runs whenever
    // the token changes, which is the only time either can be stale.
    setError(null);
    setTranscript(null);
    if (shareToken === undefined) {
      setError("This link is missing its conversation.");
      return;
    }
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      try {
        setTranscript(
          await fetchSharedTranscript(shareToken, controller.signal),
        );
      } catch (loadError) {
        if (controller.signal.aborted) {
          return;
        }
        setError(
          loadError instanceof Error ? loadError.message : String(loadError),
        );
      }
    };
    void load();
    return () => {
      controller.abort();
    };
  }, [shareToken]);

  if (error !== null) {
    return (
      <div className="mx-auto max-w-3xl space-y-4 p-6">
        <h1 className="text-xl font-semibold tracking-tight">
          Conversation unavailable
        </h1>
        <p className="text-sm text-scout-subtle">{error}</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/explore">Go to Explore</Link>
        </Button>
      </div>
    );
  }

  if (transcript === null) {
    return (
      <div className="p-6">
        <SectionSkeleton />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {transcript.conversation.title}
        </h1>
        <p className="text-xs text-scout-subtle">
          A shared Scout Explore conversation. The results are a snapshot from
          when it was asked.
        </p>
      </header>

      <ExploreTranscript messages={transcript.messages} />

      <footer className="border-t pt-4">
        <p className="text-sm text-scout-subtle">
          Want to ask your own questions of Scout&apos;s match data?
        </p>
        <Button asChild size="sm" className="mt-2">
          <Link to="/explore">Open Explore</Link>
        </Button>
      </footer>
    </div>
  );
}
