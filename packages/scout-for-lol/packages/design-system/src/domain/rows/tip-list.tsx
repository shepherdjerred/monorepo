import { ChevronDown } from "lucide-react";
import { cn } from "#src/lib/cn.ts";
import { ChampionFace } from "#src/domain/profile/champion-face.tsx";
import { AssetIcon, type AssetRef } from "./asset-icon.tsx";

export type TipIcon = {
  asset: AssetRef;
  /** The ability's name, or the lane. Read aloud with the tip. */
  label: string;
};

export type Tip = {
  id: string;
  text: string;
  /** The abilities the tip is about; a lane icon sits in a disc. */
  icons?: readonly TipIcon[];
};

export type TipReverse = {
  /** "Playing Syndra into Ahri". */
  title: string;
  /** The other side's champion; its face leads the closed row. */
  champion: string | number;
  tips: readonly Tip[];
};

export type TipListProps = {
  tips: readonly Tip[];
  /** The same matchup from the other side, closed until opened. */
  reverse?: TipReverse;
  className?: string;
};

function TipRows({ tips }: { tips: readonly Tip[] }) {
  return (
    <ol className="scout-tip-list__rows">
      {tips.map((tip) => (
        <li key={tip.id} className="scout-tip-list__tip">
          {tip.icons === undefined || tip.icons.length === 0 ? null : (
            <span className="scout-tip-list__icons">
              {tip.icons.map((icon) => (
                <AssetIcon
                  key={`${icon.asset.kind}-${String(icon.asset.key)}`}
                  asset={icon.asset}
                  label={icon.label}
                />
              ))}
            </span>
          )}
          <span className="scout-tip-list__text">{tip.text}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Generated tips, one sentence each, led by the ability icons they are about.
 * With `reverse` the other side's tips sit in a native disclosure below,
 * showing its first tip while closed.
 */
export function TipList({ tips, reverse, className }: TipListProps) {
  const first = reverse?.tips[0];
  return (
    <div className={cn("scout-tip-list", className)}>
      <TipRows tips={tips} />
      {reverse === undefined ? null : (
        <details className="scout-tip-list__flip">
          <summary>
            <ChampionFace champion={reverse.champion} alt="" />
            <span className="scout-tip-list__flip-text">
              <b>{reverse.title}</b>
              {first === undefined ? null : <span>“{first.text}”</span>}
            </span>
            <ChevronDown
              className="scout-tip-list__chevron"
              size={18}
              aria-hidden="true"
            />
          </summary>
          <div className="scout-tip-list__flip-body">
            <TipRows tips={reverse.tips} />
          </div>
        </details>
      )}
    </div>
  );
}
