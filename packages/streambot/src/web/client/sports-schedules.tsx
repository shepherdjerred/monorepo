import { useEffect, useState } from "react";
import type { z } from "zod";
import {
  MeSchema,
  CommandResultSchema,
} from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { ScheduleResultsSchema } from "@shepherdjerred/streambot/sports/schedule-types.ts";
import { api } from "./api.ts";

export async function scheduleRequest(
  path: string,
  input: { guildId: string; selectionId?: string; id?: string },
) {
  const me = await api("/api/me", MeSchema);
  return await api(path, CommandResultSchema, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-csrf-token": me.csrfToken,
    },
    body: JSON.stringify(input),
  });
}

export function SportsSchedules(props: {
  guildId: string;
  refresh: number;
  onMessage: (text: string) => void;
}) {
  const [items, setItems] = useState<z.infer<typeof ScheduleResultsSchema>>([]);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const next = await api(
          "/api/sports/schedules?" +
            new URLSearchParams({ guildId: props.guildId }).toString(),
          ScheduleResultsSchema,
          { signal: controller.signal },
        );
        if (!controller.signal.aborted) {
          setItems(next);
          setError("");
        }
      } catch (error_) {
        if (!controller.signal.aborted)
          setError(
            error_ instanceof Error
              ? error_.message
              : "Schedules are unavailable.",
          );
      }
    }
    void load();
    return () => {
      controller.abort();
    };
  }, [props.guildId, props.refresh, reload]);
  async function cancel(id: string) {
    setBusy(true);
    setError("");
    try {
      const result = await scheduleRequest("/api/sports/schedules/cancel", {
        guildId: props.guildId,
        id,
      });
      props.onMessage(result.message);
      setReload((n) => n + 1);
    } catch (error_) {
      setError(
        error_ instanceof Error ? error_.message : "Cancellation failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Scheduled LoL playback">
      <h2>Your scheduled series</h2>
      <p className="muted">
        Schedules use your current Discord voice channel and selected video
        slot. Playback starts only with listeners present and an idle slot, and
        stops after the series.
      </p>
      {error !== "" && <p role="alert">{error}</p>}
      {items.length === 0 && error === "" && <p>No series scheduled yet.</p>}
      {items.map((item) => (
        <article className="media-row" key={item.id}>
          <div className="media-info">
            <h3>{item.title}</h3>
            <p>
              {item.channelName} ·{" "}
              {item.startsAt === null
                ? "Time unavailable"
                : new Date(item.startsAt).toLocaleString()}{" "}
              · Video {item.slot} · {item.status}
              {item.reason === "listeners"
                ? " — waiting for listeners"
                : item.reason === "busy"
                  ? " — waiting for an idle slot"
                  : ""}
            </p>
          </div>
          {["pending", "starting", "playing"].includes(item.status) && (
            <button
              disabled={busy}
              onClick={() => {
                void cancel(item.id);
              }}
            >
              Cancel
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
