import { cn } from "#src/lib/cn.ts";

export type GoldLeadPoint = {
  timeMs: number;
  /** Gold lead of the first team; negative when the second team leads. */
  lead: number | null;
};

export type GoldLeadChartProps = {
  points: readonly GoldLeadPoint[];
  /** Where the viewer is in the game, drawn as a dashed line. */
  cursorMs?: number;
  /** The team a positive lead belongs to. */
  positiveName?: string;
  negativeName?: string;
  className?: string;
};

/** "12:05" from milliseconds. */
export function matchClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, "0")}`;
}

/** The lead at one moment, in words. */
export function goldLeadText(
  value: number | null,
  positiveName: string,
  negativeName: string,
): string {
  if (value === null) return "Gold comparison unavailable";
  if (value === 0) return "Gold is even";
  return `${value > 0 ? positiveName : negativeName} team leads by ${Math.abs(value).toLocaleString("en-US")} gold`;
}

const WIDTH = 1000;
const MIDLINE = 90;
const SPAN = 75;

/** The largest absolute lead, at least 1,000, so a close game is not blown up. */
export function goldScale(points: readonly GoldLeadPoint[]): number {
  return Math.max(1000, ...points.map((point) => Math.abs(point.lead ?? 0)));
}

function coordinates(
  points: readonly GoldLeadPoint[],
  maxTime: number,
  scale: number,
  side: "line" | "positive" | "negative",
): string[] {
  return points.map((point) => {
    const lead = point.lead ?? 0;
    const shown =
      side === "positive"
        ? Math.max(lead, 0)
        : side === "negative"
          ? Math.min(lead, 0)
          : lead;
    const x = Math.round((point.timeMs / maxTime) * WIDTH * 10) / 10;
    const y = Math.round((MIDLINE - (shown / scale) * SPAN) * 10) / 10;
    return `${String(x)},${String(y)}`;
  });
}

/** The text a screen reader gets in place of the chart. */
export function goldLeadSummary(
  points: readonly GoldLeadPoint[],
  positiveName: string,
  negativeName: string,
): string {
  const known = points.filter((point) => point.lead !== null);
  const last = known.at(-1);
  if (last === undefined) return "Gold comparison unavailable.";
  const biggest = known.reduce((best, point) =>
    Math.abs(point.lead ?? 0) > Math.abs(best.lead ?? 0) ? point : best,
  );
  return `Gold advantage over time. ${goldLeadText(last.lead, positiveName, negativeName)} at ${matchClock(last.timeMs)}. The largest gap was ${Math.abs(biggest.lead ?? 0).toLocaleString("en-US")} gold at ${matchClock(biggest.timeMs)}.`;
}

/**
 * The gold difference between two teams over a game: a line through the
 * middle, one team's lead above it and the other's below, a dashed cursor for
 * the moment being looked at. The values are in the text alternative and in a
 * table inside the disclosure.
 */
export function GoldLeadChart({
  points,
  cursorMs,
  positiveName = "Blue",
  negativeName = "Red",
  className,
}: GoldLeadChartProps) {
  const known = points.filter((point) => point.lead !== null);
  const maxTime = Math.max(1, points.at(-1)?.timeMs ?? 0);
  const scale = goldScale(known);
  const line = coordinates(known, maxTime, scale, "line");
  const closed = (side: "positive" | "negative"): string => {
    const edge = coordinates(known, maxTime, scale, side);
    const first = known[0];
    const last = known.at(-1);
    if (first === undefined || last === undefined) return "";
    const x0 = Math.round((first.timeMs / maxTime) * WIDTH * 10) / 10;
    const x1 = Math.round((last.timeMs / maxTime) * WIDTH * 10) / 10;
    return `M${String(x0)},${String(MIDLINE)} L${edge.join(" L")} L${String(x1)},${String(MIDLINE)} Z`;
  };
  const cursor =
    cursorMs === undefined
      ? undefined
      : Math.round(Math.min(cursorMs / maxTime, 1) * WIDTH * 10) / 10;
  return (
    <div className={cn("scout-gold-chart", className)}>
      <div className="scout-gold-chart__axis">
        <span>{positiveName} ahead</span>
        <span>{scale.toLocaleString("en-US")} gold</span>
      </div>
      <svg
        viewBox={`0 0 ${String(WIDTH)} 180`}
        preserveAspectRatio="none"
        role="img"
        aria-label={goldLeadSummary(points, positiveName, negativeName)}
      >
        <line
          className="scout-gold-chart__zero"
          x1="0"
          x2={WIDTH}
          y1={MIDLINE}
          y2={MIDLINE}
        />
        {known.length < 2 ? null : (
          <>
            <path
              className="scout-gold-chart__area"
              data-side="positive"
              d={closed("positive")}
            />
            <path
              className="scout-gold-chart__area"
              data-side="negative"
              d={closed("negative")}
            />
            <path
              className="scout-gold-chart__line"
              d={`M${line.join(" L")}`}
            />
          </>
        )}
        {cursor === undefined ? null : (
          <line
            className="scout-gold-chart__cursor"
            x1={cursor}
            x2={cursor}
            y1="0"
            y2="180"
          />
        )}
      </svg>
      <div className="scout-gold-chart__axis">
        <span>{negativeName} ahead</span>
        <span>{matchClock(maxTime)}</span>
      </div>
      <details className="scout-gold-chart__values">
        <summary>Gold values</summary>
        <div>
          <table>
            <caption className="scout-sr-only">
              Gold advantage at each point in the game
            </caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Advantage</th>
              </tr>
            </thead>
            <tbody>
              {points.map((point) => (
                <tr key={point.timeMs}>
                  <th scope="row">{matchClock(point.timeMs)}</th>
                  <td>
                    {goldLeadText(point.lead, positiveName, negativeName)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
