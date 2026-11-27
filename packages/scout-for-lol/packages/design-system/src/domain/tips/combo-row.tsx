import { Badge } from "#src/components/badge.tsx";
import { cn } from "#src/lib/cn.ts";
import { ComboSequence } from "#src/domain/tips/combo-sequence.tsx";
import { TipText, type TipTooltipExtras } from "#src/domain/tips/tip-text.tsx";
import type {
  OutputCombo,
  OutputMatchupSet,
} from "@scout-for-lol/data/tips/output/champion-tips.ts";

/** What a matchup side says about one of its champion's combos. */
export type ComboRefData = OutputMatchupSet["comboRefs"][number];

const CATEGORY_LABELS: Record<OutputCombo["category"], string> = {
  combo: "Combo",
  trick: "Trick",
  rotation: "Rotation",
  terrain: "Terrain",
};

type ComboProps = {
  tooltipExtras?: TipTooltipExtras | undefined;
  className?: string | undefined;
};

/**
 * One generated combo, trick, rotation or terrain spot: its name and category,
 * the sequence as icons with a chevron between steps, the situation to use it
 * in, and how it works. Every step and every referenced phrase opens a rich
 * tooltip, so this must sit inside a `GameFactProvider`.
 */
export function ComboRow(props: ComboProps & { combo: OutputCombo }) {
  const { combo, tooltipExtras, className } = props;
  return (
    <article className={cn("scout-combo-row", className)}>
      <header className="scout-combo-row__head">
        <b className="scout-combo-row__name">{combo.name}</b>
        <Badge variant="outline">{CATEGORY_LABELS[combo.category]}</Badge>
      </header>
      {combo.sequence.length === 0 ? null : (
        <ComboSequence
          steps={combo.sequence}
          size="regular"
          tooltipExtras={tooltipExtras}
        />
      )}
      <p className="scout-combo-row__when">
        <TipText
          text={combo.when}
          refs={combo.whenRefs}
          tooltipExtras={tooltipExtras}
        />
      </p>
      <p className="scout-combo-row__text">
        <TipText
          text={combo.text}
          refs={combo.textRefs}
          tooltipExtras={tooltipExtras}
        />
      </p>
    </article>
  );
}

/**
 * A combo a matchup side points at, compact: the sequence, the combo's name,
 * and the side's note on why it works or fails here. `combos` is the
 * champion's general set for the same lane, where `comboRef.comboId` lives; an
 * id that is not there is a broken contract and throws.
 */
export function ComboRef(
  props: ComboProps & {
    comboRef: ComboRefData;
    combos: readonly OutputCombo[];
  },
) {
  const { comboRef, combos, tooltipExtras, className } = props;
  const combo = combos.find((candidate) => candidate.id === comboRef.comboId);
  if (combo === undefined) {
    throw new Error(
      `Combo ${comboRef.comboId} is not in the champion's combos`,
    );
  }
  return (
    <article className={cn("scout-combo-ref", className)}>
      {combo.sequence.length === 0 ? null : (
        <ComboSequence
          steps={combo.sequence}
          size="compact"
          tooltipExtras={tooltipExtras}
        />
      )}
      <div className="scout-combo-ref__body">
        <b className="scout-combo-ref__name">{combo.name}</b>
        <p className="scout-combo-ref__note">
          <TipText
            text={comboRef.note}
            refs={comboRef.refs}
            tooltipExtras={tooltipExtras}
          />
        </p>
      </div>
    </article>
  );
}
