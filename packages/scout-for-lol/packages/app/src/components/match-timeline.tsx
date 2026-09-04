import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import * as echarts from "echarts";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { TimelineFrameTable } from "#src/components/timeline-frame-table.tsx";
import {
  TimelinePagination,
  type TimelineCursor,
} from "#src/components/timeline-pagination.tsx";
import { useTRPC, type RouterOutputs } from "#src/lib/trpc.ts";

type Coverage =
  RouterOutputs["consumerMatch"]["detail"]["timeline"]["coverage"];
type TimelineEvent = RouterOutputs["consumerMatch"]["events"]["rows"][number];
type ChartPoint =
  RouterOutputs["consumerMatch"]["chartSeries"]["points"][number];

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

export function MatchTimeline(props: {
  playerId: number;
  matchId: string;
  coverage: Coverage;
  keyEvents: TimelineEvent[];
  participantIds: number[];
}) {
  const trpc = useTRPC();
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
  const baseInput = { playerId: props.playerId, matchId: props.matchId };
  const events = useQuery(
    trpc.consumerMatch.events.queryOptions(
      {
        ...baseInput,
        ...(eventType === undefined ? {} : { eventTypes: [eventType] }),
        ...(participantId === undefined
          ? {}
          : { participantIds: [participantId] }),
        ...(eventCursors[eventPage] === undefined
          ? {}
          : { cursor: eventCursors[eventPage] }),
      },
      {
        enabled: props.coverage !== null,
        placeholderData: keepPreviousData,
      },
    ),
  );
  const frames = useQuery(
    trpc.consumerMatch.frames.queryOptions(
      {
        ...baseInput,
        ...(participantId === undefined
          ? {}
          : { participantIds: [participantId] }),
        ...(frameCursors[framePage] === undefined
          ? {}
          : { cursor: frameCursors[framePage] }),
      },
      {
        enabled: props.coverage !== null,
        placeholderData: keepPreviousData,
      },
    ),
  );
  const chart = useQuery(
    trpc.consumerMatch.chartSeries.queryOptions(baseInput, {
      enabled: props.coverage !== null,
    }),
  );

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

  function resetPages(): void {
    setEventCursors([undefined]);
    setFrameCursors([undefined]);
    setEventPage(0);
    setFramePage(0);
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

      {chart.isError ? (
        <p className="text-sm text-scout-danger">
          Timeline charts did not load.
        </p>
      ) : chart.data === undefined ? (
        <p className="text-sm text-scout-subtle">Loading timeline charts…</p>
      ) : (
        <TimelineCharts points={chart.data.points} />
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
        {events.isError ? (
          <p className="text-sm text-scout-danger">Events did not load.</p>
        ) : (
          <div className="space-y-2">
            {(events.data?.rows ?? []).map((event) => (
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
              pending={events.isFetching}
              nextCursor={events.data?.nextCursor}
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
          rows={frames.data?.rows ?? []}
          error={frames.isError}
          pending={frames.isFetching}
          page={framePage}
          nextCursor={frames.data?.nextCursor}
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

function TimelineCharts(props: { points: ChartPoint[] }) {
  const teamIds = [
    ...new Set(
      props.points.flatMap((point) =>
        point.teamGold.map((team) => team.teamId),
      ),
    ),
  ];
  const timeLabels = props.points.map((point) =>
    Math.round(point.timestampMs / 60_000),
  );
  const teamSeries = teamIds.map((teamId) => ({
    name: `Team ${teamId.toString()}`,
    type: "line" as const,
    showSymbol: false,
    data: props.points.map(
      (point) =>
        point.teamGold.find((team) => team.teamId === teamId)?.gold ?? null,
    ),
  }));
  const playerSeries = [
    {
      name: "Gold",
      type: "line" as const,
      showSymbol: false,
      data: props.points.map((point) => point.selectedGold),
    },
    {
      name: "XP",
      type: "line" as const,
      showSymbol: false,
      data: props.points.map((point) => point.selectedXp),
    },
  ];
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <TimelineChart
        title="Team gold"
        labels={timeLabels}
        series={teamSeries}
      />
      <TimelineChart
        title="Selected-player progression"
        labels={timeLabels}
        series={playerSeries}
      />
    </div>
  );
}

function TimelineChart(props: {
  title: string;
  labels: number[];
  series: {
    name: string;
    type: "line";
    showSymbol: boolean;
    data: (number | null)[];
  }[];
}) {
  const container = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (container.current === null) return;
    const chart = echarts.init(container.current);
    chart.setOption({
      title: {
        text: props.title,
        left: 12,
        top: 8,
        textStyle: { fontSize: 14 },
      },
      tooltip: { trigger: "axis" },
      legend: { top: 34 },
      grid: { top: 70, left: 52, right: 18, bottom: 36 },
      xAxis: { type: "category", name: "min", data: props.labels },
      yAxis: { type: "value" },
      series: props.series,
    });
    const observer = new ResizeObserver(() => {
      chart.resize();
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [props.labels, props.series, props.title]);
  return (
    <div
      ref={container}
      className="h-72 rounded-md border bg-card"
      role="img"
      aria-label={props.title}
    />
  );
}
