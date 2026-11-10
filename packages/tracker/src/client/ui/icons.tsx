import type { BootstrapData } from "#client/data/api.ts";

type StateType = BootstrapData["states"][number]["type"];

const ring = { cx: 7, cy: 7, r: 5.5, fill: "none", strokeWidth: 1.5 };

/** A status as Linear draws it: how far along the workflow it is. */
export function StateIcon({
  type,
  color,
  size = 14,
}: {
  type: StateType;
  color: string;
  size?: number;
}) {
  return (
    <svg
      className="state-icon"
      width={size}
      height={size}
      viewBox="0 0 14 14"
      aria-hidden="true"
      style={{ color }}
    >
      <StateShape type={type} />
    </svg>
  );
}

function StateShape({ type }: { type: StateType }) {
  switch (type) {
    case "triage": {
      return (
        <>
          <circle {...ring} stroke="currentColor" strokeDasharray="1.4 1.6" />
          <path d="M4.5 7h5M7.6 5l2 2-2 2" stroke="currentColor" fill="none" />
        </>
      );
    }
    case "backlog": {
      return (
        <circle {...ring} stroke="currentColor" strokeDasharray="2.2 1.6" />
      );
    }
    case "unstarted": {
      return <circle {...ring} stroke="currentColor" />;
    }
    case "started": {
      return (
        <>
          <circle {...ring} stroke="currentColor" />
          <path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor" />
        </>
      );
    }
    case "completed": {
      return (
        <>
          <circle cx={7} cy={7} r={6.25} fill="currentColor" />
          <path
            d="m4.4 7.2 1.8 1.8 3.5-3.7"
            stroke="var(--panel)"
            strokeWidth={1.5}
            fill="none"
          />
        </>
      );
    }
    case "canceled":
    case "duplicate": {
      return (
        <>
          <circle cx={7} cy={7} r={6.25} fill="currentColor" />
          <path
            d="m5 5 4 4m0-4-4 4"
            stroke="var(--panel)"
            strokeWidth={1.5}
            fill="none"
          />
        </>
      );
    }
  }
}

/** Urgent is a warning mark; the rest are signal bars, none for no priority. */
export function PriorityGlyph({
  value,
  size = 14,
}: {
  value: number;
  size?: number;
}) {
  if (value === 1) {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
        <rect x={1} y={1} width={12} height={12} rx={3} fill="currentColor" />
        <path
          d="M7 3.8v4M7 9.6v.6"
          stroke="var(--panel)"
          strokeWidth={1.6}
          strokeLinecap="round"
        />
      </svg>
    );
  }
  if (value === 0) {
    return (
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
        {[2, 6, 10].map((x) => (
          <rect
            key={x}
            x={x}
            y={6.25}
            width={2.5}
            height={1.5}
            rx={0.5}
            fill="currentColor"
          />
        ))}
      </svg>
    );
  }
  // High lights three bars, medium two, low one.
  const lit = 5 - value;
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden="true">
      {[0, 1, 2].map((bar) => (
        <rect
          key={bar}
          x={1.5 + bar * 4}
          y={9 - bar * 3}
          width={3}
          height={3.5 + bar * 3}
          rx={0.75}
          fill="currentColor"
          opacity={bar < lit ? 1 : 0.3}
        />
      ))}
    </svg>
  );
}
