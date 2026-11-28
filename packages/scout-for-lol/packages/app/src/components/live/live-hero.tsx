import { HeroPanel } from "@scout-for-lol/design-system/domain/profile/hero-panel";
import type { ReactNode } from "react";
import { Link } from "react-router";
import type { LiveHeroLines } from "#src/lib/live/live-game.ts";

/** The hero's title row: the name and, beside it, whether the game is going. */
export function LiveState(props: { ended: boolean }) {
  return (
    <span className="inline-flex h-9 items-center gap-2 rounded-full bg-[var(--scout-surface-inset)] pr-3.5 pl-3 text-[15px] font-semibold whitespace-nowrap shadow-[var(--scout-ring)] sm:h-8">
      <i
        aria-hidden="true"
        className={
          props.ended
            ? "size-2.5 rounded-full bg-scout-subtle"
            : "size-2.5 rounded-full bg-scout-win shadow-[0_0_0_4px_color-mix(in_srgb,var(--scout-color-success-on-surface)_22%,transparent)]"
        }
      />
      {props.ended ? "Game over" : "In a game now"}
    </span>
  );
}

/** The lead panel of a live game: who is playing what, and for how long. */
export function LiveHero(props: {
  lines: LiveHeroLines;
  ended: boolean;
  children?: ReactNode;
}) {
  const { lines } = props;
  return (
    <HeroPanel aria-labelledby="live-h" art={{ champion: lines.championId }}>
      <nav
        aria-label="Breadcrumb"
        className="mb-3.5 flex items-center gap-2.5 text-[15px] text-scout-subtle"
      >
        <Link
          to="/live"
          className="underline decoration-scout-subtle/40 underline-offset-4 hover:text-scout-ink"
        >
          Live
        </Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{`${lines.title}'s game`}</span>
      </nav>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <h1
          id="live-h"
          className="m-0 font-display text-5xl leading-none font-bold [overflow-wrap:anywhere] sm:text-6xl"
        >
          {lines.title}
        </h1>
        <LiveState ended={props.ended} />
      </div>
      <p className="mt-4 mb-0 max-w-[34ch] font-display text-3xl leading-tight text-balance">
        {lines.lead}
      </p>
      <p className="mt-3 mb-0 max-w-[46ch] text-lg text-pretty text-scout-subtle">
        {lines.sub}
      </p>
      {props.children}
    </HeroPanel>
  );
}
