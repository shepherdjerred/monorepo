import { useLayoutEffect, useState } from "react";
import { clusterPins, type PinCluster } from "#client/lib/cluster.ts";
import type { Pin } from "#client/lib/pins.ts";
import type { AnchorAdapter } from "./types.ts";

type Placed = {
  readonly cluster: PinCluster;
  readonly pins: readonly Pin[];
  readonly approximate: boolean;
};

function describe(pin: Pin): string {
  const where =
    pin.stale && pin.versionNumber !== null
      ? `on v${String(pin.versionNumber)}`
      : "";
  return `Thread ${String(pin.index)}${where === "" ? "" : `, ${where}`}, ${pin.state}`;
}

/**
 * Pins over a viewer. The layer is a sibling of the (possibly scaled) content,
 * so every pin stays one size whatever the zoom. Pins closer than 24 px share
 * a marker with a count. A pin whose version is not the one shown is hollow.
 */
export function PinsOverlay({
  pins,
  adapterRef,
  stage,
  tick,
  selectedId,
  onSelect,
}: {
  readonly pins: readonly Pin[];
  readonly adapterRef: { current: AnchorAdapter | null };
  readonly stage: HTMLElement | null;
  readonly tick: number;
  readonly selectedId: string | null;
  readonly onSelect: (threadId: string) => void;
}): React.JSX.Element {
  const [placed, setPlaced] = useState<readonly Placed[]>([]);

  useLayoutEffect(() => {
    const adapter = adapterRef.current;
    if (adapter === null || stage === null) {
      setPlaced([]);
      return;
    }
    const origin = stage.getBoundingClientRect();
    const positioned: { id: string; x: number; y: number }[] = [];
    for (const pin of pins) {
      const at = adapter.toClient(pin.anchor);
      if (at === null) continue;
      const x = at.x - origin.left;
      const y = at.y - origin.top;
      if (x < -12 || y < -12 || x > origin.width + 12 || y > origin.height + 12)
        continue;
      positioned.push({ id: pin.id, x, y });
    }
    const byId = new Map(pins.map((pin) => [pin.id, pin]));
    setPlaced(
      clusterPins(positioned).map((cluster) => {
        const members = cluster.ids.flatMap((id) => byId.get(id) ?? []);
        return {
          cluster,
          pins: members,
          approximate: members.some(
            (pin) => adapter.approximate?.(pin.anchor) === true,
          ),
        };
      }),
    );
  }, [pins, adapterRef, stage, tick]);

  return (
    <div className="ar-pins" data-testid="pins-layer">
      {placed.map(({ cluster, pins: members, approximate }) => {
        const [first] = members;
        if (first === undefined) return null;
        const selected = members.some((pin) => pin.id === selectedId);
        const next =
          members.length > 1
            ? (members[
                (members.findIndex((pin) => pin.id === selectedId) + 1) %
                  members.length
              ] ?? first)
            : first;
        const hollow = members.every((pin) => pin.stale);
        const resolved = members.every((pin) => pin.state === "resolved");
        return (
          <button
            key={cluster.ids.join(",")}
            type="button"
            className="ar-pin"
            data-selected={selected}
            data-hollow={hollow}
            data-resolved={resolved}
            data-approximate={approximate}
            data-testid="pin"
            style={{ left: cluster.x, top: cluster.y }}
            aria-pressed={selected}
            aria-label={
              members.length === 1
                ? describe(first)
                : `${String(members.length)} threads: ${members.map((pin) => String(pin.index)).join(", ")}`
            }
            title={approximate ? "Approximate position" : undefined}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(next.id);
            }}
          >
            {members.length === 1 ? first.index : members.length}
          </button>
        );
      })}
    </div>
  );
}
