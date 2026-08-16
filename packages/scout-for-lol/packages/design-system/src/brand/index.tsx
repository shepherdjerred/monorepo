import type { SVGProps } from "react";
import { cn } from "#src/lib/cn.ts";
import { ScoutEmblem as ScoutEmblemGeometry } from "./emblem.ts";

export function ScoutEmblem(props: SVGProps<SVGSVGElement>) {
  return <ScoutEmblemGeometry {...props} />;
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
