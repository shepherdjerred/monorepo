import type { HTMLAttributes, ReactNode } from "react";
import { Panel } from "#src/components/surfaces/panel.tsx";
import { cn } from "#src/lib/cn.ts";
import { HeroArtImage, type HeroArt } from "./hero-art.tsx";

export type DuelHeroProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  /** The verdict, centred between the champions: heading, lead, controls. */
  children: ReactNode;
  /** The champion on the left, looking right. */
  start: HeroArt;
  /** The champion on the right, looking left. */
  end: HeroArt;
};

/**
 * Two champions facing each other across a centred verdict, as on a matchup
 * page. Each one fades in from its own edge. Give it `aria-labelledby` and the
 * heading's id so it is a landmark.
 */
export function DuelHero({
  children,
  start,
  end,
  className,
  ...props
}: DuelHeroProps) {
  return (
    <Panel variant="hero" asChild>
      <section {...props} className={cn("scout-duel-hero", className)}>
        <HeroArtImage art={start} side="start" />
        <HeroArtImage art={end} side="end" />
        <div className="scout-duel-hero__text">{children}</div>
      </section>
    </Panel>
  );
}
