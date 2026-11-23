import { type ReactNode, useState } from "react";
import type { PublicReplayDescriptor } from "@scout-for-lol/domain/artifacts/public-replay.ts";
import { Button } from "@scout-for-lol/design-system/components/button";

export type ReplayPageState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; replay: PublicReplayDescriptor };

export function playbackMessage(replay: PublicReplayDescriptor): {
  heading: string;
  message: string;
} | null {
  const playback = replay.playback;
  switch (playback.status) {
    case "available":
      return null;
    case "metadata_pending":
      return {
        heading: "Replay is being checked",
        message:
          "The upload is stored. Scout is checking the information needed to play it.",
      };
    case "support_preparing":
      return {
        heading: "Replay playback is being prepared",
        message:
          "This replay is stored, but playback support for its game build is not ready yet. You can share this link and return later.",
      };
    case "incompatible":
      return {
        heading: "Replay playback is unavailable",
        message:
          playback.reason === "older_patch"
            ? "This replay was recorded on an older patch. Scout currently supports playback for the latest patch only."
            : playback.reason === "unsupported_map" ||
                playback.reason === "unsupported_mode" ||
                playback.reason === "unsupported_roster"
              ? "Scout currently supports standard Summoner’s Rift 5v5 replay playback. This replay is outside the supported matches."
              : "Scout cannot play this replay’s game build yet. The stored replay has been preserved.",
      };
  }
}

export function ReplayPageView(props: {
  state: ReplayPageState;
  onRetry?: () => void;
  onShare?: () => Promise<void>;
  analysis?: ReactNode;
  children?: ReactNode;
}) {
  const [shareStatus, setShareStatus] = useState("");
  const replay = props.state.status === "loaded" ? props.state.replay : null;
  const unavailable = replay === null ? null : playbackMessage(replay);
  const share = async () => {
    try {
      await props.onShare?.();
      setShareStatus("Replay link copied.");
    } catch {
      setShareStatus("Could not copy. Share this page’s address instead.");
    }
  };
  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-6 text-scout-ink sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-scout-brand">Scout replay</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {replay?.matchId ?? "Match replay"}
          </h1>
          <p className="text-sm text-scout-subtle">
            Review and share a League match.
            {replay?.gameBuild == null ? "" : ` · Build ${replay.gameBuild}`}
          </p>
        </div>
        {replay !== null && props.onShare !== undefined && (
          <div className="space-y-1">
            <Button
              variant="outline"
              onClick={() => {
                void share();
              }}
            >
              Copy replay link
            </Button>
            <p role="status" className="text-xs text-scout-subtle">
              {shareStatus}
            </p>
          </div>
        )}
      </header>
      {props.state.status === "loading" && (
        <div
          role="status"
          className="rounded-xl border border-scout-border bg-scout-surface px-6 py-16 text-center text-scout-subtle"
        >
          Loading replay…
        </div>
      )}
      {props.state.status === "error" && (
        <div className="space-y-3 rounded-xl border border-scout-border bg-scout-surface p-6">
          <h2 className="text-lg font-semibold">Replay unavailable</h2>
          <p role="alert" className="text-sm text-scout-subtle">
            {props.state.message}
          </p>
          {props.onRetry !== undefined && (
            <Button onClick={props.onRetry}>Try again</Button>
          )}
        </div>
      )}
      {unavailable !== null && (
        <div className="space-y-2 rounded-xl border border-scout-border bg-scout-surface px-6 py-12">
          <h2 className="text-xl font-semibold">{unavailable.heading}</h2>
          <p className="max-w-2xl text-sm leading-6 text-scout-subtle">
            {unavailable.message}
          </p>
        </div>
      )}
      {props.state.status === "loaded" &&
        unavailable === null &&
        props.children}
      {props.state.status === "loaded" && props.analysis}
    </div>
  );
}
