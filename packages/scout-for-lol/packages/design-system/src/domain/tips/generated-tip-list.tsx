import { ChampionPortrait, GameAssetImage } from "#src/assets/index.tsx";
import { Fold } from "#src/components/surfaces/fold.tsx";
import { cn } from "#src/lib/cn.ts";
import { TipText, type TipTooltipExtras } from "#src/domain/tips/tip-text.tsx";
import type { OutputTip } from "@scout-for-lol/data/tips/output/champion-tips.ts";

/** Most ability icons that lead one tip. */
export const TIP_ICONS_MAX = 2;

export type GeneratedTipReverse = {
  /** Names the closed row, for example "Playing Zed into Ahri". */
  label: string;
  /** The other side's champion key; its portrait leads the closed row. */
  champion: string;
  /** That side's tips, hidden ones included; they are filtered here. */
  tips: readonly OutputTip[];
};

export type GeneratedTipListProps = {
  /** One tip set's tips as generated, hidden ones included. */
  tips: readonly OutputTip[];
  /** The same matchup from the other side, closed until opened. */
  reverse?: GeneratedTipReverse | undefined;
  tooltipExtras?: TipTooltipExtras | undefined;
  className?: string | undefined;
};

const visibleTips = (tips: readonly OutputTip[]): OutputTip[] =>
  tips.filter((tip) => tip.hidden !== true);

/** The abilities a tip names, once each, in the order the text names them. */
export function tipAbilityKeys(tip: OutputTip): string[] {
  const keys = tip.refs
    .toSorted((left, right) => left.start - right.start)
    .filter((ref) => ref.kind === "ability")
    .map((ref) => ref.key);
  return [...new Set(keys)].slice(0, TIP_ICONS_MAX);
}

function TipRows(props: {
  tips: readonly OutputTip[];
  tooltipExtras?: TipTooltipExtras | undefined;
}) {
  return (
    <ol className="scout-generated-tips__rows">
      {props.tips.map((tip) => {
        const abilities = tipAbilityKeys(tip);
        return (
          <li key={tip.id} className="scout-generated-tips__tip">
            {abilities.length === 0 ? null : (
              <span className="scout-generated-tips__icons" aria-hidden="true">
                {abilities.map((key) => (
                  <span key={key} className="scout-generated-tips__icon">
                    <GameAssetImage kind="ability" assetKey={key} alt="" />
                  </span>
                ))}
              </span>
            )}
            <TipText
              className="scout-generated-tips__text"
              text={tip.text}
              refs={tip.refs}
              tooltipExtras={props.tooltipExtras}
            />
          </li>
        );
      })}
    </ol>
  );
}

/**
 * A tip set, one sentence each, led by the icons of the abilities it names and
 * with every named entity a tooltip trigger. Hidden tips are left out. The
 * other side of the matchup sits in a native disclosure, closed, showing its
 * first tip. Must sit inside a `GameFactProvider`.
 */
export function GeneratedTipList(props: GeneratedTipListProps) {
  const { reverse, tooltipExtras, className } = props;
  const tips = visibleTips(props.tips);
  const reverseTips = reverse === undefined ? [] : visibleTips(reverse.tips);
  const first = reverseTips[0];
  return (
    <div className={cn("scout-generated-tips", className)}>
      {tips.length === 0 ? null : (
        <TipRows tips={tips} tooltipExtras={tooltipExtras} />
      )}
      {reverse === undefined || first === undefined ? null : (
        <Fold
          className="scout-generated-tips__flip"
          summary={
            <span className="scout-generated-tips__flip-summary">
              <ChampionPortrait
                className="scout-generated-tips__flip-face"
                champion={reverse.champion}
                alt=""
              />
              <span className="scout-generated-tips__flip-text">
                <b>{reverse.label}</b>
                <span>“{first.text}”</span>
              </span>
            </span>
          }
        >
          <TipRows tips={reverseTips} tooltipExtras={tooltipExtras} />
        </Fold>
      )}
    </div>
  );
}
