import { useId, useState } from "react";
import type { z } from "zod";
import { CommandResultSchema } from "@shepherdjerred/streambot/web/shared/contracts.ts";
import { ScheduleResultsSchema } from "@shepherdjerred/streambot/sports/schedule-types.ts";
import {
  apiRequest,
  apiUrl,
  postJson,
} from "@shepherdjerred/streambot/web/client/api.ts";
import { ControlStatus } from "@shepherdjerred/streambot/web/client/control-status.tsx";
import { FailureNotice } from "@shepherdjerred/streambot/web/client/failure-notice.tsx";
import { useRemote } from "@shepherdjerred/streambot/web/client/remote.tsx";
import { useControl } from "@shepherdjerred/streambot/web/client/use-control.ts";
import { useLoad } from "@shepherdjerred/streambot/web/client/use-load.ts";
import "@shepherdjerred/streambot/web/client/styles/row.css";

type Scheduled = z.infer<typeof ScheduleResultsSchema>[number];

const WAITING: Readonly<Partial<Record<Scheduled["reason"], string>>> = {
  listeners: "Waiting for listeners",
  busy: "Waiting for an idle video stream",
};

/** Whether a schedule can still be cancelled: it has not finished. */
export function isActive(status: Scheduled["status"]): boolean {
  return status === "pending" || status === "starting" || status === "playing";
}

const STARTS = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

function ScheduledRow(props: {
  item: Scheduled;
  guildId: string;
  onCancelled: (message: string) => void;
}) {
  const { item } = props;
  const remote = useRemote();
  const control = useControl();
  const [confirming, setConfirming] = useState(false);
  const cancel = () => {
    setConfirming(false);
    control.run(async (signal) => {
      const result = await apiRequest(
        "/api/sports/schedules/cancel",
        CommandResultSchema,
        postJson(
          { guildId: props.guildId, id: item.id },
          remote.me.csrfToken,
          signal,
        ),
      );
      if (!result.ok) return { ok: false, failure: result.failure };
      props.onCancelled(result.data.message);
      return { ok: true, message: result.data.message };
    });
  };
  const detail = [
    item.startsAt === null
      ? "Time unavailable"
      : STARTS.format(new Date(item.startsAt)),
    "Video stream " + String(item.slot),
    item.status === "pending" ? WAITING[item.reason] : item.status,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");
  return (
    <li className="row">
      <div className="row-text">
        <span className="row-title">{item.title}</span>
        <span className="row-detail">{detail}</span>
      </div>
      {isActive(item.status) && (
        <div className="row-actions btn-row">
          {confirming ? (
            <>
              <button type="button" className="btn" onClick={cancel}>
                Cancel this series
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn"
              aria-disabled={control.pending}
              onClick={() => {
                if (!control.pending) setConfirming(true);
              }}
            >
              Cancel
              <span className="visually-hidden"> schedule: {item.title}</span>
            </button>
          )}
        </div>
      )}
      <ControlStatus className="row-status" control={control} />
    </li>
  );
}

/**
 * The viewer's scheduled series. Schedules use the viewer's voice channel and selected video
 * stream, start only with listeners present and a free stream, and stop after the series.
 */
export function ScheduleList(props: { guildId: string }) {
  const headingId = useId();
  const [note, setNote] = useState("");
  const load = useLoad(
    apiUrl("/api/sports/schedules", { guildId: props.guildId }),
    ScheduleResultsSchema,
  );
  return (
    <section className="section" aria-labelledby={headingId}>
      <div className="section-head">
        <h2 id={headingId} className="section-heading">
          Your scheduled series
        </h2>
      </div>
      <p className="section-note">
        A scheduled series starts in your voice channel once it is live, with
        listeners present and a video stream free, and stops when it ends.
      </p>
      <p className="status status-ok" role="status">
        {note}
      </p>
      {load.state.status === "loading" && (
        <p className="empty-note" aria-busy="true">
          Loading your schedules…
        </p>
      )}
      {load.state.status === "failed" && (
        <p className="status">
          <FailureNotice failure={load.state.failure} onRetry={load.retry} />
        </p>
      )}
      {load.state.status === "done" && load.state.data.length === 0 && (
        <p className="empty-note">No series scheduled yet.</p>
      )}
      {load.state.status === "done" && load.state.data.length > 0 && (
        <ul className="rows">
          {load.state.data.map((item) => (
            <ScheduledRow
              key={item.id}
              item={item}
              guildId={props.guildId}
              onCancelled={(message) => {
                setNote(message);
                load.retry();
              }}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
