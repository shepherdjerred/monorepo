import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@scout-for-lol/design-system/components/button";
import type { PublicReplayTimeline } from "@scout-for-lol/domain/artifacts/public-replay-timeline.ts";
import {
  readReplayShareState,
  replayClock,
  replayShareUrl,
} from "#src/lib/replay/share-state.ts";
import {
  ReplayKdaScoreboard,
  type ReplayKdaTimeline,
} from "./replay-kda-scoreboard.tsx";
import {
  eventTeam,
  eventTitle,
  readReplayEventFilter,
  replayEventGroups,
  type EventFilter,
  type ResearchTimelineEvent,
  type TimelineEvent,
} from "./replay-analysis-events.ts";

type TimelineSelection = {
  timestampMs: number;
  id?: number;
};
type AliveCount = { timestampMs: number; teamA: number; teamB: number };

export type ReplayAnalysisState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | { status: "unavailable" }
  | { status: "ready"; timeline: PublicReplayTimeline };

function timelineDurationMs(
  duration: number | null,
  events: readonly TimelineEvent[],
  scoreboard: ReplayKdaTimeline | undefined,
) {
  return Math.max(
    Math.round((duration ?? 0) * 1000),
    events.at(-1)?.timestampMs ?? 0,
    scoreboard?.checkpoints.at(-1)?.timestampMs ?? 0,
  );
}

function ReplayEventTimeline(props: {
  events: readonly TimelineEvent[];
  research?: boolean;
  returnsAvailable?: boolean;
  aliveCounts?: readonly AliveCount[] | null;
  kdaTimeline?: ReplayKdaTimeline;
  turretsAvailable?: boolean;
  inhibitorsAvailable?: boolean;
  durationSeconds: number | null;
  search: string;
}) {
  const id = useId();
  const eventTypeId = useId();
  const { events } = props;
  const research = props.research === true;
  const groups = replayEventGroups(props);
  const durationMs = timelineDurationMs(
    props.durationSeconds,
    events,
    props.kdaTimeline,
  );
  const [selection, setSelection] = useState<TimelineSelection | null>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const clock = useRef({ timeMs: 0, lastTick: 0 });
  const [filter, setFilter] = useState<EventFilter>("all");
  const [shareStatus, setShareStatus] = useState("");
  const [manualLink, setManualLink] = useState<string | null>(null);
  const timeMs = Math.min(
    selection?.timestampMs ??
      Math.round(
        readReplayShareState(props.search, durationMs / 1000).timeSeconds *
          1000,
      ),
    durationMs,
  );
  const alive = props.aliveCounts?.findLast(
    ({ timestampMs }) => timestampMs <= timeMs,
  );
  useEffect(() => {
    if (!playing) return;
    clock.current.lastTick = performance.now();
    const interval = globalThis.setInterval(() => {
      const now = performance.now();
      clock.current.timeMs = Math.min(
        durationMs,
        clock.current.timeMs + (now - clock.current.lastTick) * rate,
      );
      clock.current.lastTick = now;
      setSelection({
        timestampMs: Math.floor(clock.current.timeMs),
      });
      if (clock.current.timeMs >= durationMs) setPlaying(false);
    }, 250);
    return () => {
      globalThis.clearInterval(interval);
    };
  }, [durationMs, playing, rate]);
  const visible = useMemo(
    () => events.filter((event) => filter === "all" || event.type === filter),
    [events, filter],
  );
  const markers = useMemo(
    () =>
      visible.map((event) => (
        <span
          key={event.id}
          className="absolute bottom-0 h-2 w-0.5 -translate-x-1/2 rounded-full bg-scout-subtle"
          style={{
            left: `${String(durationMs === 0 ? 0 : (event.timestampMs / durationMs) * 100)}%`,
          }}
        />
      )),
    [durationMs, visible],
  );
  const selectedId = selection?.id;
  const selectedEvent =
    selectedId === undefined
      ? undefined
      : visible.find((event) => event.id === selectedId);
  const moment =
    selectedEvent ?? visible.findLast((event) => event.timestampMs <= timeMs);
  const selectTime = useCallback((next: TimelineSelection) => {
    clock.current = { timeMs: next.timestampMs, lastTick: performance.now() };
    setSelection(next);
    setShareStatus("");
    setManualLink(null);
  }, []);
  const togglePlayback = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    selectTime({ timestampMs: timeMs === durationMs ? 0 : timeMs });
    setPlaying(true);
  };
  const activeId = moment?.id;
  const eventList = useMemo(
    () =>
      visible.length === 0 ? (
        <p className="mt-3 text-sm text-scout-subtle">
          No events of this type.
        </p>
      ) : (
        <ol className="mt-2 max-h-80 list-decimal divide-y divide-scout-border overflow-y-auto rounded-lg border border-scout-border marker:text-transparent">
          {visible.map((event) => {
            const active = event.id === activeId;
            const team = eventTeam(event);
            return (
              <li key={event.id}>
                <button
                  type="button"
                  className="grid w-full grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-scout-canvas focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-scout-brand aria-[current=time]:bg-scout-canvas"
                  aria-current={active ? "time" : undefined}
                  onClick={() => {
                    selectTime(event);
                  }}
                >
                  <span className="font-semibold tabular-nums text-scout-brand">
                    {replayClock(event.timestampMs / 1000)}
                  </span>
                  <span>
                    <span className="font-medium">{eventTitle(event)}</span>
                    {team !== null && (
                      <span className="ml-2 text-scout-subtle">{team}</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      ),
    [activeId, selectTime, visible],
  );
  const share = async () => {
    const url = new URL(replayShareUrl(globalThis.location.href, null));
    url.searchParams.set("t", (timeMs / 1000).toFixed(3));
    try {
      await navigator.clipboard.writeText(url.href);
      setManualLink(null);
      setShareStatus(`Link to ${replayClock(timeMs / 1000)} copied.`);
    } catch {
      setManualLink(url.href);
      setShareStatus(
        "Could not copy automatically. Copy the timestamp link below.",
      );
    }
  };

  if (events.length === 0 && props.kdaTimeline === undefined) {
    return (
      <p className="text-sm text-scout-subtle">No key events were recorded.</p>
    );
  }

  return (
    <>
      <div className="space-y-3 rounded-lg border border-scout-border bg-scout-canvas p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <label htmlFor={id} className="text-sm font-medium">
              Match time
            </label>
            <p className="text-2xl font-semibold tabular-nums">
              {replayClock(timeMs / 1000)}
              <span className="ml-2 text-sm font-normal text-scout-subtle">
                / {replayClock(durationMs / 1000)}
              </span>
            </p>
          </div>
          {!research && (
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                void share();
              }}
            >
              Copy timestamp link
            </Button>
          )}
          {alive !== undefined && (
            <dl className="flex flex-wrap gap-3 text-sm font-medium">
              <div>
                <dt>Team A alive</dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {alive.teamA} / 5
                </dd>
              </div>
              <div>
                <dt>Team B alive</dt>
                <dd className="text-xl font-semibold tabular-nums">
                  {alive.teamB} / 5
                </dd>
              </div>
            </dl>
          )}
        </div>
        <div aria-hidden="true" className="relative mx-2 h-3">
          {markers}
        </div>
        <input
          id={id}
          type="range"
          min={0}
          max={durationMs}
          step="any"
          disabled={durationMs === 0}
          value={timeMs}
          aria-valuetext={replayClock(timeMs / 1000)}
          className="block h-6 w-full"
          onChange={(event) => {
            selectTime({
              timestampMs: Math.round(event.currentTarget.valueAsNumber),
            });
          }}
        />
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            onClick={togglePlayback}
            disabled={durationMs === 0}
          >
            {playing ? "Pause timeline" : "Play timeline"}
          </Button>
          <label className="flex items-center gap-2 text-sm text-scout-subtle">
            Timeline speed
            <select
              className="rounded-md border border-scout-border bg-scout-surface px-2 py-1.5 text-scout-ink"
              value={rate}
              onChange={(event) => {
                setRate(Number(event.currentTarget.value));
              }}
            >
              <option value={1}>1×</option>
              <option value={2}>2×</option>
              <option value={4}>4×</option>
            </select>
          </label>
        </div>
        {moment !== undefined && (
          <p className="text-sm font-medium text-scout-ink">
            {moment.timestampMs < timeMs && (
              <span className="mr-2 font-normal text-scout-subtle">
                Latest event at {replayClock(moment.timestampMs / 1000)}{" "}
              </span>
            )}
            {eventTitle(moment)}
          </p>
        )}
        {!research && (
          <p role="status" className="text-sm text-scout-subtle">
            {shareStatus}
          </p>
        )}
        {!research && manualLink !== null && (
          <label className="block text-sm text-scout-subtle">
            Timestamp link
            <input
              className="mt-1 block w-full rounded border border-scout-border bg-scout-surface px-2 py-1 text-scout-ink"
              type="url"
              readOnly
              value={manualLink}
              onFocus={(event) => {
                event.currentTarget.select();
              }}
            />
          </label>
        )}
      </div>

      {props.kdaTimeline !== undefined && (
        <ReplayKdaScoreboard timeline={props.kdaTimeline} timeMs={timeMs} />
      )}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Key events</h3>
        <div className="flex items-center gap-2 text-sm text-scout-subtle">
          <label htmlFor={eventTypeId}>Event type</label>
          <select
            id={eventTypeId}
            className="rounded-md border border-scout-border bg-scout-canvas px-2 py-1.5 text-scout-ink"
            value={filter}
            onChange={(event) => {
              const value = event.currentTarget.value;
              const selected = readReplayEventFilter(value);
              if (selected !== undefined && Object.hasOwn(groups, selected))
                setFilter(selected);
            }}
          >
            {Object.entries(groups).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {eventList}
    </>
  );
}

export function ReplayAnalysis(props: {
  state: ReplayAnalysisState;
  durationSeconds: number | null;
  search: string;
}) {
  const { state } = props;
  return (
    <section className="space-y-3 rounded-xl border border-scout-border bg-scout-surface p-4 sm:p-6">
      <header>
        <h2 className="text-xl font-semibold">Replay analysis</h2>
        {state.status === "ready" && (
          <p className="mt-1 text-sm text-scout-subtle">
            Key events from Riot’s match timeline.
          </p>
        )}
      </header>
      {state.status === "loading" && (
        <p className="text-sm text-scout-subtle">Loading match events…</p>
      )}
      {state.status === "unavailable" && (
        <p className="text-sm text-scout-subtle">
          Verified match events are unavailable for this replay.
        </p>
      )}
      {state.status === "error" && (
        <>
          <p role="status" className="text-sm text-scout-subtle">
            Scout could not load the match events.
          </p>
          <Button variant="outline" type="button" onClick={state.retry}>
            Retry match events
          </Button>
        </>
      )}
      {state.status === "ready" && (
        <ReplayEventTimeline
          events={state.timeline.events}
          durationSeconds={props.durationSeconds}
          search={props.search}
        />
      )}
    </section>
  );
}

export function ReplayResearchCombatAnalysis(props: {
  events: readonly ResearchTimelineEvent[];
  returnsAvailable: boolean;
  aliveCounts: readonly AliveCount[] | null;
  kdaTimeline?: ReplayKdaTimeline;
  turretsAvailable: boolean;
  inhibitorsAvailable: boolean;
  durationSeconds: number;
  search: string;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-scout-border bg-scout-surface p-4 sm:p-6">
      <header>
        <h2 className="text-xl font-semibold">Replay combat analysis</h2>
        <p className="mt-1 text-sm text-scout-subtle">
          Events decoded from the local ROFL.
        </p>
        {!props.returnsAvailable && (
          <p className="mt-1 text-sm text-scout-subtle">
            Verified champion returns are unavailable for this replay.
          </p>
        )}
        {!props.turretsAvailable && (
          <p className="mt-1 text-sm text-scout-subtle">
            Verified turret destructions are unavailable for this replay.
          </p>
        )}
        {!props.inhibitorsAvailable && (
          <p className="mt-1 text-sm text-scout-subtle">
            Verified inhibitor destructions are unavailable for this replay.
          </p>
        )}
      </header>
      <ReplayEventTimeline {...props} research />
    </section>
  );
}
