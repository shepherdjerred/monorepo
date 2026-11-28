import { ChevronRight } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { cn } from "#src/lib/cn.ts";
import { formatPercent } from "#src/domain/profile/win-rate-bar.tsx";
import { AssetIcon, type AssetRef } from "./asset-icon.tsx";
import { gamesLabel } from "./format.ts";

export type SetupItem = {
  label: string;
  asset: AssetRef;
  /** The keystone rune: its icon is not ringed like the others. */
  keystone?: boolean;
  /** Starts a new line after this item, as between rune trees. */
  breakAfter?: boolean;
};

export type SetupProof = {
  /** Win rate with this setup, in percent. */
  winRate: number;
  games: number;
  /** How often this setup is picked, in percent. */
  pickRate?: number;
};

export type SetupRowProps = {
  /** "Runes", "Summoner spells", "Starting items". */
  title: string;
  items: readonly SetupItem[];
  /** Items in the order they happen: a chevron sits between them. */
  sequence?: boolean;
  /** A short note after the items, such as "Domination, with Sorcery second". */
  note?: ReactNode;
  proof?: SetupProof;
  className?: string;
};

/**
 * One step of a setup as a row of icons with words: runes, summoner spells, a
 * build. The win rate and the games behind it sit on the right.
 */
export function SetupRow({
  title,
  items,
  sequence = false,
  note,
  proof,
  className,
}: SetupRowProps) {
  const List = sequence ? "ol" : "ul";
  return (
    <div className={cn("scout-setup-row", className)}>
      <h3 className="scout-setup-row__title">{title}</h3>
      <List className="scout-setup-row__items">
        {items.map((item, index) => (
          <Fragment
            key={`${item.asset.kind}-${String(item.asset.key)}-${String(index)}`}
          >
            {sequence && index > 0 ? (
              <li className="scout-setup-row__then" aria-hidden="true">
                <ChevronRight size={14} />
              </li>
            ) : null}
            <li
              className="scout-setup-row__item"
              data-kind={item.asset.kind}
              data-keystone={item.keystone === true ? "true" : undefined}
            >
              <AssetIcon asset={item.asset} label="" />
              <span>{item.label}</span>
            </li>
            {item.breakAfter === true ? (
              <li className="scout-setup-row__break" aria-hidden="true" />
            ) : null}
          </Fragment>
        ))}
        {note === undefined ? null : (
          <li className="scout-setup-row__note">{note}</li>
        )}
      </List>
      {proof === undefined ? null : (
        <p className="scout-setup-row__proof">
          <b>{formatPercent(proof.winRate)}</b> wins
          <span>from {gamesLabel(proof.games)}</span>
          {proof.pickRate === undefined ? null : (
            <span>Picked {formatPercent(proof.pickRate)}</span>
          )}
        </p>
      )}
    </div>
  );
}
