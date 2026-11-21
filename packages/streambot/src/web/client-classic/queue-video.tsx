import { useState } from "react";
import type { z } from "zod";
import type { WebSnapshot } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { CommandResultSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { MusicMatchesSchema } from "@shepherdjerred/streambot/music/contracts.ts";
import { api, playerCommand } from "./api.ts";

export function QueueVideo(props: {
  snapshot: WebSnapshot;
  guildId: string;
  csrfToken: string;
  position: number;
  busy: boolean;
}) {
  const [matches, setMatches] = useState<z.infer<
    typeof MusicMatchesSchema
  > | null>(null);
  const [snapshot, setSnapshot] = useState(props.snapshot);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function request(selectionId?: string) {
    setBusy(true);
    setMessage("");
    const playback = selectionId === undefined ? props.snapshot : snapshot;
    try {
      const init = {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": props.csrfToken,
        },
        body: JSON.stringify({
          playback: playerCommand(
            { action: "volume", percent: 100 },
            props.guildId,
            playback,
          ),
          position: props.position,
          selectionId,
        }),
      };
      const url = "/api/music/queue-match?guildId=" + props.guildId;
      if (selectionId === undefined) {
        setSnapshot(props.snapshot);
        setMatches(await api(url, MusicMatchesSchema, init));
      } else {
        const result = await api(url, CommandResultSchema, init);
        setMessage(result.message);
        setMatches(null);
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not change this recording.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="queue-video">
      <button
        disabled={busy || props.busy}
        onClick={() => {
          void request();
        }}
      >
        Choose video
      </button>
      {message !== "" && <p role="status">{message}</p>}
      {matches !== null && (
        <section className="match-picker" aria-label="YouTube recordings">
          {matches.length === 0 && <p>No matching videos were found.</p>}
          {matches.map((match) => (
            <button
              key={match.url}
              disabled={busy || match.selectionId === undefined}
              onClick={() => {
                void request(match.selectionId);
              }}
            >
              {match.title}
              <small>{match.channel}</small>
            </button>
          ))}
          <button
            onClick={() => {
              setMatches(null);
            }}
          >
            Close
          </button>
        </section>
      )}
    </div>
  );
}
