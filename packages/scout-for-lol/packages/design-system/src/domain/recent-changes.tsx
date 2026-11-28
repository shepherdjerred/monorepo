import { normalizeBrowserChampionKey } from "@scout-for-lol/data/browser-assets";
import { useId, type ReactNode } from "react";
import type {
  RecentChange,
  RecentChangePatch,
} from "@scout-for-lol/data/data-dragon/patch-changes-recent.ts";
import type { PatchChangeDirection } from "@scout-for-lol/data/data-dragon/patch-changes-direction.ts";
import {
  ChampionPortrait,
  GameAssetImage,
  ItemIcon,
} from "#src/assets/index.tsx";
import { Panel } from "#src/components/surfaces/panel.tsx";
import { cn } from "#src/lib/cn.ts";
import { formatPercent } from "./profile/win-rate-bar.tsx";

export type WinRateReading = { winRate: number; games: number };

/** A champion's win rate before and after a patch, with the games behind each. */
export type PatchWinRateShift = {
  before: WinRateReading;
  after: WinRateReading;
};

/** What a custom ability label is rendered for. */
export type AbilityLabelContext = {
  change: RecentChange;
  /** The text the row shows when no custom label is given. */
  label: string;
};

export type RecentChangesProps = {
  /** From `getRecentChampionChanges`, newest first. */
  patches: readonly RecentChangePatch[];
  /** The champion the changes belong to; their icon sits on ability rows. */
  championId: number;
  /** Win rate before and after, by patch number such as "26.23". */
  winRates?: Readonly<Record<string, PatchWinRateShift>>;
  /**
   * Renders the bold name of a row, for example to open a tooltip on the
   * ability. Defaults to the plain label.
   */
  renderAbilityLabel?: (context: AbilityLabelContext) => ReactNode;
  /** Where "See all changes" goes. Omit to leave the link out. */
  allChangesHref?: string;
  /** How many patches were searched, for the empty state. */
  windowPatches?: number;
  /** The moment ages are measured from. Defaults to now. */
  now?: Date;
  className?: string;
};

const DIRECTION_LABEL: Record<PatchChangeDirection, string> = {
  buff: "Buffed",
  nerf: "Nerfed",
  adjust: "Adjusted",
};

const MS_PER_DAY = 86_400_000;

/** "today", "3 days ago", "2 weeks ago", "5 months ago" for a `YYYY-MM-DD` date. */
export function formatPatchAge(date: string, now: Date): string {
  const days = Math.max(
    0,
    Math.floor((now.getTime() - Date.parse(`${date}T00:00:00Z`)) / MS_PER_DAY),
  );
  const format = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (days < 7) return format.format(-days, "day");
  if (days < 60) return format.format(-Math.floor(days / 7), "week");
  return days < 730
    ? format.format(-Math.floor(days / 30), "month")
    : format.format(-Math.floor(days / 365), "year");
}

/** The bold line of a row: the ability, the item, or "Base stats". */
export function changeLabel(change: RecentChange): string {
  return change.subject.kind === "item"
    ? change.subject.name
    : (change.ability?.name ?? "Base stats");
}

/** The quiet line of a row: what moved, with the item's own passive if it has one. */
export function changeDetail(change: RecentChange): string {
  return change.subject.kind === "item" && change.ability !== null
    ? `${change.ability.name} · ${change.stat}`
    : change.stat;
}

/**
 * Rows carry their own mark only when the patch is mixed: some row moves a
 * different way from the champion's own direction.
 */
export function isMixedPatch(patch: RecentChangePatch): boolean {
  return patch.changes.some((change) => change.direction !== patch.direction);
}

function DirectionGlyph({ direction }: { direction: PatchChangeDirection }) {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      {direction === "buff" ? (
        <path d="M10 4 17 16H3z" />
      ) : direction === "nerf" ? (
        <path d="M3 4h14L10 16z" />
      ) : (
        <path d="M3 8.5h14v3H3z" />
      )}
    </svg>
  );
}

function ChangeIcon({
  change,
  championId,
}: {
  change: RecentChange;
  championId: number;
}) {
  if (change.subject.kind === "item") {
    return (
      <ItemIcon
        item={change.subject.id}
        alt=""
        className="scout-recent-changes__icon"
      />
    );
  }
  const slot = change.ability?.slot;
  if (slot === undefined || slot === null) {
    return (
      <ChampionPortrait
        champion={championId}
        alt=""
        className="scout-recent-changes__icon"
      />
    );
  }
  // LeBlanc's recast is the one "RW" slot; its icon is her ultimate's.
  return (
    <GameAssetImage
      kind="ability"
      assetKey={`${normalizeBrowserChampionKey(championId)}-${slot === "RW" ? "R" : slot}`}
      alt=""
      className="scout-recent-changes__icon"
    />
  );
}

function ChangeRow({
  change,
  championId,
  marked,
  renderAbilityLabel,
}: {
  change: RecentChange;
  championId: number;
  marked: boolean;
  renderAbilityLabel: RecentChangesProps["renderAbilityLabel"];
}) {
  const label = changeLabel(change);
  return (
    <li className="scout-recent-changes__row" data-direction={change.direction}>
      <ChangeIcon change={change} championId={championId} />
      <span className="scout-recent-changes__what">
        <b>
          {renderAbilityLabel === undefined
            ? label
            : renderAbilityLabel({ change, label })}
        </b>
        <span className="scout-recent-changes__detail">
          {changeDetail(change)}
        </span>
        <span className="scout-recent-changes__values">
          {marked ? (
            <span
              className="scout-recent-changes__mark"
              data-direction={change.direction}
            >
              <DirectionGlyph direction={change.direction} />
              <span className="scout-sr-only">
                {DIRECTION_LABEL[change.direction]}
              </span>
            </span>
          ) : null}
          <span className="scout-recent-changes__was">Was {change.before}</span>{" "}
          now <b className="scout-recent-changes__now">{change.after}</b>
        </span>
      </span>
    </li>
  );
}

function games(count: number): string {
  return count.toLocaleString("en-US");
}

function WinRateSince({ shift }: { shift: PatchWinRateShift }) {
  return (
    <p className="scout-recent-changes__since">
      Won <b>{formatPercent(shift.after.winRate)}</b> of{" "}
      {games(shift.after.games)} games since. Before,{" "}
      <b>{formatPercent(shift.before.winRate)}</b> of{" "}
      {games(shift.before.games)}.
    </p>
  );
}

/**
 * A champion's balance changes, one block per patch, newest first. The pill
 * shows the champion's own direction; in a patch where rows move differently
 * (a champion buff beside an item nerf) every row carries its own mark.
 */
export function RecentChanges({
  patches,
  championId,
  winRates,
  renderAbilityLabel,
  allChangesHref,
  windowPatches,
  now,
  className,
}: RecentChangesProps) {
  const headingId = useId();
  const reference = now ?? new Date();
  return (
    <Panel asChild>
      <section
        className={cn("scout-recent-changes", className)}
        aria-labelledby={headingId}
      >
        <div className="scout-recent-changes__head">
          <h2 id={headingId}>Recent changes</h2>
          {allChangesHref === undefined || patches.length === 0 ? null : (
            <a className="scout-recent-changes__link" href={allChangesHref}>
              See all changes
            </a>
          )}
        </div>
        {patches.length === 0 ? (
          <p className="scout-recent-changes__empty">
            {windowPatches === undefined
              ? "No recent changes"
              : `No changes in the last ${String(windowPatches)} patches`}
          </p>
        ) : (
          <ol className="scout-recent-changes__patches">
            {patches.map((patch) => {
              const shift = winRates?.[patch.patch];
              const marked = isMixedPatch(patch);
              return (
                <li key={patch.patch} className="scout-recent-changes__patch">
                  <div className="scout-recent-changes__patch-head">
                    <h3>Patch {patch.patch}</h3>
                    <time
                      className="scout-recent-changes__age"
                      dateTime={patch.date}
                    >
                      {formatPatchAge(patch.date, reference)}
                    </time>
                    <span
                      className="scout-recent-changes__direction"
                      data-direction={patch.direction}
                    >
                      <DirectionGlyph direction={patch.direction} />
                      {DIRECTION_LABEL[patch.direction]}
                    </span>
                  </div>
                  <ul className="scout-recent-changes__list">
                    {patch.changes.map((change, index) => (
                      <ChangeRow
                        key={`${change.subject.kind}-${String(change.subject.id)}-${String(index)}`}
                        change={change}
                        championId={championId}
                        marked={marked}
                        renderAbilityLabel={renderAbilityLabel}
                      />
                    ))}
                  </ul>
                  {shift === undefined ? null : <WinRateSince shift={shift} />}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </Panel>
  );
}
