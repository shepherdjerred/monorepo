import type { SVGProps } from "react";
import { cn } from "#src/lib/cn.ts";

export function ScoutEmblem(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden={props["aria-label"] === undefined ? "true" : undefined}
      {...props}
    >
      <path
        d="M16 1.75 28.25 8.8v14.4L16 30.25 3.75 23.2V8.8L16 1.75Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="m16 5.25 2.45 7.8L26.25 16l-7.8 2.95L16 26.75l-2.45-7.8L5.75 16l7.8-2.95L16 5.25Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle
        cx="16"
        cy="16"
        r="3.25"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <circle cx="16" cy="16" r="1.15" fill="currentColor" />
    </svg>
  );
}

export function ScoutMark(props: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("scout-mark", props.className)}>
      <ScoutEmblem width={28} height={28} />
      {props.compact === true ? null : (
        <span className="scout-wordmark">SCOUT</span>
      )}
    </span>
  );
}
