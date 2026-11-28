import type { Anchor } from "@shepherdjerred/artifacts/contract";
import type { Point } from "#client/lib/geometry.ts";
import { anchorLabel } from "#client/lib/pins.ts";
import { Composer } from "#client/threads/composer.tsx";

export type Placement = { readonly anchor: Anchor; readonly at: Point };

const WIDTH = 300;

/** The popover that takes the text of a new pin, placed next to it. */
export function PlacementComposer({
  placement,
  pane,
  pending,
  onSubmit,
  onCancel,
}: {
  readonly placement: Placement;
  readonly pane: HTMLElement | null;
  readonly pending: boolean;
  readonly onSubmit: (body: string) => void;
  readonly onCancel: () => void;
}): React.JSX.Element {
  const origin = pane?.getBoundingClientRect();
  const left = Math.min(
    Math.max(8, placement.at.x - (origin?.left ?? 0) + 14),
    Math.max(8, (origin?.width ?? WIDTH) - WIDTH - 8),
  );
  const top = Math.min(
    Math.max(8, placement.at.y - (origin?.top ?? 0) - 12),
    Math.max(8, (origin?.height ?? 300) - 190),
  );
  return (
    <div
      className="ar-popover"
      role="group"
      aria-label={`New comment: ${anchorLabel(placement.anchor)}`}
      style={{ left, top }}
      data-testid="placement-composer"
    >
      <Composer
        label={`Comment · ${anchorLabel(placement.anchor)}`}
        autoFocus
        pending={pending}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </div>
  );
}
