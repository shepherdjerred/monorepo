import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import type { ExploreTranscript as Transcript } from "@scout-for-lol/data";
import { Button } from "#src/components/ui/button.tsx";
import { ExploreTranscript } from "#src/components/explore-transcript.tsx";
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
        <p className="text-sm text-muted-foreground">{error}</p>
        <Button asChild variant="outline" size="sm">
          <Link to="/explore">Go to Explore</Link>
        </Button>
      </div>
    );
  }

  if (transcript === null) {
    return (
      <p className="p-6 text-sm text-muted-foreground">Loading conversation…</p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">
          {transcript.conversation.title}
        </h1>
        <p className="text-xs text-muted-foreground">
          A shared Scout Explore conversation. The results are a snapshot from
          when it was asked.
        </p>
      </header>

      <ExploreTranscript messages={transcript.messages} />

      <footer className="border-t pt-4">
        <p className="text-sm text-muted-foreground">
          Want to ask your own questions of Scout&apos;s match data?
        </p>
        <Button asChild size="sm" className="mt-2">
          <Link to="/explore">Open Explore</Link>
        </Button>
      </footer>
    </div>
  );
}
