import { Fragment } from "react";
import { cn } from "#src/lib/cn.ts";
import {
  GameFactTooltip,
  type EntityTooltipExtras,
} from "#src/domain/tooltips/entity-tooltip.tsx";
import { splitTipText } from "#src/domain/tips/tip-text-segments.ts";
import type { GameFactKind } from "@scout-for-lol/data/game-facts/schema.ts";
import type { TextRef } from "@scout-for-lol/data/tips/output/champion-tips.ts";

/**
 * What the page adds to the tooltip a reference opens: its own Scout block,
 * the link out, and the same for the parts inside. `defaultOpen` and
 * `presentation` show one in place, as the stories do.
 */
export type TipTooltipOptions = EntityTooltipExtras & {
  defaultOpen?: boolean | undefined;
  presentation?: "auto" | "popover" | "sheet" | undefined;
};

/**
 * Called with the entity a reference names; return nothing for the plain game
 * tooltip.
 */
export type TipTooltipExtras = (
  kind: GameFactKind,
  key: string,
) => TipTooltipOptions | undefined;

export type TipTextProps = {
  text: string;
  /** The spans of `text` that name a game entity, as generated. */
  refs: readonly TextRef[];
  tooltipExtras?: TipTooltipExtras | undefined;
  className?: string | undefined;
};

/**
 * One generated sentence with every referenced phrase as a rich-tooltip
 * trigger: "Charm" opens the ability, "stunned" opens the keyword. Must sit
 * inside a `GameFactProvider`. A span that does not fit the text throws; see
 * `splitTipText`.
 */
export function TipText(props: TipTextProps) {
  const { text, refs, tooltipExtras, className } = props;
  return (
    <span className={cn("scout-tip-text", className)}>
      {splitTipText(text, refs).map((segment) =>
        segment.type === "text" ? (
          <Fragment key={segment.start}>{segment.text}</Fragment>
        ) : (
          <GameFactTooltip
            key={segment.start}
            kind={segment.ref.kind}
            factKey={segment.ref.key}
            label={segment.text}
            {...tooltipExtras?.(segment.ref.kind, segment.ref.key)}
          >
            <button type="button" className="scout-tip-text__ref">
              {segment.text}
            </button>
          </GameFactTooltip>
        ),
      )}
    </span>
  );
}
