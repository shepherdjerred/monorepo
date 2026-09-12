import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { TimelineFrameTable } from "#src/components/match/timeline-frame-table.tsx";
import { TimelineCharts } from "#src/components/match/match-timeline-charts.tsx";
import {
  TimelinePagination,
  type TimelineCursor,
} from "#src/components/match/timeline-pagination.tsx";
import { useTRPC, type RouterOutputs } from "#src/lib/query/trpc.ts";

type Coverage =
  RouterOutputs["consumerMatch"]["detail"]["timeline"]["coverage"];
type TimelineEvent = RouterOutputs["consumerMatch"]["events"]["rows"][number];
type TimelineFrame = RouterOutputs["consumerMatch"]["frames"]["rows"][number];

type TimelineData = {
  events: {
    data:
      { nextCursor: TimelineCursor | null; rows: TimelineEvent[] } | undefined;
    isError: boolean;
    isFetching: boolean;
  };
  frames: {
    data:
      { nextCursor: TimelineCursor | null; rows: TimelineFrame[] } | undefined;
    isError: boolean;
    isFetching: boolean;
  };
  chart: {
    data:
      | {
          points: RouterOutputs["consumerMatch"]["chartSeries"]["points"];
        }
      | undefined;
    isError: boolean;
  };
};

type TimelineState = {
  eventType: string | undefined;
  participantId: number | undefined;
  eventCursors: (TimelineCursor | undefined)[];
  frameCursors: (TimelineCursor | undefined)[];
  eventPage: number;
  framePage: number;
  setEventType: (value: string | undefined) => void;
  setParticipantId: (value: number | undefined) => void;
  setEventCursors: (
    value:
      | (TimelineCursor | undefined)[]
      | ((
          value: (TimelineCursor | undefined)[],
        ) => (TimelineCursor | undefined)[]),
  ) => void;
  setFrameCursors: (
    value:
      | (TimelineCursor | undefined)[]
      | ((
          value: (TimelineCursor | undefined)[],
        ) => (TimelineCursor | undefined)[]),
  ) => void;
  setEventPage: (value: number | ((value: number) => number)) => void;
  setFramePage: (value: number | ((value: number) => number)) => void;
  resetPages: () => void;
};

const EVENT_TYPES = [
  "CHAMPION_KILL",
  "ELITE_MONSTER_KILL",
  "BUILDING_KILL",
  "ITEM_PURCHASED",
  "ITEM_SOLD",
  "ITEM_UNDO",
  "SKILL_LEVEL_UP",
  "WARD_PLACED",
  "WARD_KILL",
  "GAME_END",
];

function eventTitle(event: TimelineEvent): string {
  const minute = Math.floor(event.event_timestamp_ms / 60_000);
  const seconds = Math.floor((event.event_timestamp_ms % 60_000) / 1000);
  return `${minute.toString()}:${seconds.toString().padStart(2, "0")} · ${event.event_type.replaceAll("_", " ")}`;
}

export function retainedEventFields(event: object): [string, string][] {
  return Object.entries(event)
    .filter(
      ([key, value]) =>
        value !== null &&
        ![
          "event_id",
          "event_type",
          "event_timestamp_ms",
          "frame_timestamp_ms",
        ].includes(key),
    )
    .map(([key, value]) => [key.replaceAll("_", " "), String(value)]);
}

type MatchTimelineProps = {
  source: { kind: "consumer"; playerId: number } | { kind: "explore" };
  matchId: string;
  coverage: Coverage;
  keyEvents: TimelineEvent[];
  participantIds: number[];
};

export function MatchTimeline(props: MatchTimelineProps) {
  if (props.source.kind === "consumer") {
    return (
      <ConsumerMatchTimeline {...props} playerId={props.source.playerId} />
    );
  }

  return <ExploreMatchTimeline {...props} />;
}

function ConsumerMatchTimeline(
  props: Omit<MatchTimelineProps, "source"> & { playerId: number },
) {
  const trpc = useTRPC();
  const state = useTimelineState();
  const baseInput = { playerId: props.playerId, matchId: props.matchId };
  const data: TimelineData = {
    events: useQuery(
      trpc.consumerMatch.events.queryOptions(
        timelineEventsInput(baseInput, state),
        timelineQueryOptions(props.coverage),
      ),
    ),
    frames: useQuery(
      trpc.consumerMatch.frames.queryOptions(
        timelineFramesInput(baseInput, state),
        timelineQueryOptions(props.coverage),
      ),
    ),
    chart: useQuery(
      trpc.consumerMatch.chartSeries.queryOptions(baseInput, {
        enabled: props.coverage !== null,
      }),
    ),
  };
  return <MatchTimelineContent {...props} data={data} state={state} />;
}

function ExploreMatchTimeline(props: Omit<MatchTimelineProps, "source">) {
  const trpc = useTRPC();
  const state = useTimelineState();
  const baseInput = { matchId: props.matchId };
  const data: TimelineData = {
    events: useQuery(
      trpc.exploreMatch.events.queryOptions(
        timelineEventsInput(baseInput, state),
        timelineQueryOptions(props.coverage),
      ),
    ),
    frames: useQuery(
      trpc.exploreMatch.frames.queryOptions(
        timelineFramesInput(baseInput, state),
        timelineQueryOptions(props.coverage),
      ),
    ),
    chart: useQuery(
      trpc.exploreMatch.chartSeries.queryOptions(baseInput, {
        enabled: props.coverage !== null,
      }),
    ),
  };
  return <MatchTimelineContent {...props} data={data} state={state} />;
}

function MatchTimelineContent(
  props: Omit<MatchTimelineProps, "source"> & {
    data: TimelineData;
    state: TimelineState;
  },
) {
  const {
    eventType,
    setEventType,
    participantId,
    setParticipantId,
    setEventCursors,
    setFrameCursors,
    eventPage,
    setEventPage,
    framePage,
    setFramePage,
    resetPages,
  } = props.state;
  if (props.coverage === null) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Timeline not captured</CardTitle>
          <CardDescription>
            Scout retained the match overview, but no normalized timeline was
            captured for this game. Opening this page never requests it from
            Riot.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Timeline</h2>
        <p className="text-sm text-scout-subtle">
          {props.coverage.frame_count.toLocaleString()} frames and{" "}
          {props.coverage.event_count.toLocaleString()} events retained by
          Scout.
        </p>
      </div>

      {props.data.chart.isError ? (
        <p className="text-sm text-scout-danger">
          Timeline charts did not load.
        </p>
      ) : props.data.chart.data === undefined ? (
        <p className="text-sm text-scout-subtle">Loading timeline charts…</p>
      ) : (
        <TimelineCharts points={props.data.chart.data.points} />
      )}

      <section className="space-y-3">
        <h3 className="text-xl font-semibold">Key events</h3>
        {props.keyEvents.length === 0 ? (
          <p className="text-sm text-scout-subtle">
            No categorized key events were retained.
          </p>
        ) : (
          <ol className="space-y-2 border-l pl-5">
            {props.keyEvents.map((event) => (
              <li key={event.event_id} className="text-sm">
                <strong>{eventTitle(event)}</strong>
                <span className="ml-2 text-scout-subtle">
                  {event.monster_type ??
                    event.building_type ??
                    (event.killer_id === null
                      ? ""
                      : `Participant ${event.killer_id.toString()}`)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="flex flex-wrap gap-4 rounded-lg border bg-card p-4">
        <label className="space-y-1 text-sm font-medium">
          <span className="block">Event type</span>
          <select
            name="eventType"
            value={eventType ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3"
            onChange={(event) => {
              setEventType(event.currentTarget.value || undefined);
              resetPages();
            }}
          >
            <option value="">All event types</option>
            {EVENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span className="block">Participant</span>
          <select
            name="participant"
            value={participantId?.toString() ?? ""}
            className="h-9 rounded-md border border-input bg-background px-3"
            onChange={(event) => {
              setParticipantId(
                event.currentTarget.value === ""
                  ? undefined
                  : Number(event.currentTarget.value),
              );
              resetPages();
            }}
          >
            <option value="">Everyone</option>
            {props.participantIds.map((id) => (
              <option key={id} value={id}>
                Participant {id.toString()}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="space-y-3">
        <h3 className="text-xl font-semibold">Event explorer</h3>
        <p className="text-sm text-scout-subtle">
          Every retained event is available in chronological 100-row pages.
          Unfamiliar Riot types show all non-null retained fields.
        </p>
        {props.data.events.isError ? (
          <p className="text-sm text-scout-danger">Events did not load.</p>
        ) : (
          <div className="space-y-2">
            {(props.data.events.data?.rows ?? []).map((event) => (
              <details key={event.event_id} className="rounded-md border p-3">
                <summary className="cursor-pointer text-sm font-medium">
                  {eventTitle(event)}
                </summary>
                <dl className="mt-3 grid gap-x-4 gap-y-1 text-xs sm:grid-cols-2 lg:grid-cols-4">
                  {retainedEventFields(event).map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-scout-subtle">{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            ))}
            <TimelinePagination
              page={eventPage}
              pending={props.data.events.isFetching}
              nextCursor={props.data.events.data?.nextCursor}
              onPrevious={() => {
                setEventPage((page) => page - 1);
              }}
              onNext={(cursor) => {
                setEventCursors((cursors) => [
                  ...cursors.slice(0, eventPage + 1),
                  cursor,
                ]);
                setEventPage((page) => page + 1);
              }}
            />
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h3 className="text-xl font-semibold">Frame table</h3>
        <p className="text-sm text-scout-subtle">
          Every retained frame field is shown in chronological 100-row pages.
        </p>
        <TimelineFrameTable
          rows={props.data.frames.data?.rows ?? []}
          error={props.data.frames.isError}
          pending={props.data.frames.isFetching}
          page={framePage}
          nextCursor={props.data.frames.data?.nextCursor}
          onPrevious={() => {
            setFramePage((page) => page - 1);
          }}
          onNext={(cursor) => {
            setFrameCursors((cursors) => [
              ...cursors.slice(0, framePage + 1),
              cursor,
            ]);
            setFramePage((page) => page + 1);
          }}
        />
      </section>
    </div>
  );
}

function useTimelineState(): TimelineState {
  const [eventType, setEventType] = useState<string | undefined>();
  const [participantId, setParticipantId] = useState<number | undefined>();
  const [eventCursors, setEventCursors] = useState<
    (TimelineCursor | undefined)[]
  >([undefined]);
  const [frameCursors, setFrameCursors] = useState<
    (TimelineCursor | undefined)[]
  >([undefined]);
  const [eventPage, setEventPage] = useState(0);
  const [framePage, setFramePage] = useState(0);

  return {
    eventType,
    participantId,
    eventCursors,
    frameCursors,
    eventPage,
    framePage,
    setEventType,
    setParticipantId,
    setEventCursors,
    setFrameCursors,
    setEventPage,
    setFramePage,
    resetPages: () => {
      setEventCursors([undefined]);
      setFrameCursors([undefined]);
      setEventPage(0);
      setFramePage(0);
    },
  };
}

function timelineQueryOptions(coverage: Coverage) {
  return {
    enabled: coverage !== null,
    placeholderData: keepPreviousData,
  };
}

function timelineEventsInput<T extends { matchId: string }>(
  baseInput: T,
  state: TimelineState,
) {
  return {
    ...baseInput,
    ...(state.eventType === undefined ? {} : { eventTypes: [state.eventType] }),
    ...(state.participantId === undefined
      ? {}
      : { participantIds: [state.participantId] }),
    ...(state.eventCursors[state.eventPage] === undefined
      ? {}
      : { cursor: state.eventCursors[state.eventPage] }),
  };
}

function timelineFramesInput<T extends { matchId: string }>(
  baseInput: T,
  state: TimelineState,
) {
  return {
    ...baseInput,
    ...(state.participantId === undefined
      ? {}
      : { participantIds: [state.participantId] }),
    ...(state.frameCursors[state.framePage] === undefined
      ? {}
      : { cursor: state.frameCursors[state.framePage] }),
  };
}
