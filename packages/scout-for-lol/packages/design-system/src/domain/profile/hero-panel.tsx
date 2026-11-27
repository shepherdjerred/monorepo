import type { HTMLAttributes, ReactNode } from "react";
import { Panel } from "#src/components/surfaces/panel.tsx";
import { cn } from "#src/lib/cn.ts";
import { HeroArtImage, type ArtSide, type HeroArt } from "./hero-art.tsx";

export type HeroPanelProps = Omit<HTMLAttributes<HTMLElement>, "children"> & {
  /** The words: a heading and whatever sits under it. */
  children: ReactNode;
  /** A champion fading in behind the far side. Omit for a plain hero. */
  art?: HeroArt;
  /** Which side the words sit on; the art takes the other. */
  align?: ArtSide;
  /** A control that floats over the art side, such as a search chip. */
  action?: ReactNode;
};

/**
 * The lead panel of a page: words on one side, a champion's splash art fading
 * in from the other. Without `art` it is a plain panel of words. Render it as
 * a landmark by giving it `aria-labelledby` and the heading's id.
 */
export function HeroPanel({
  children,
  art,
  align = "start",
  action,
  className,
  ...props
}: HeroPanelProps) {
  const artSide: ArtSide = align === "start" ? "end" : "start";
  return (
    <Panel variant="hero" asChild>
      <section
        {...props}
        className={cn("scout-hero-panel", className)}
        data-align={align}
        data-art={art === undefined ? "none" : "splash"}
      >
        {art === undefined ? null : <HeroArtImage art={art} side={artSide} />}
        <div className="scout-hero-panel__text">{children}</div>
        {action === undefined ? null : (
          <div className="scout-hero-panel__action" data-side={artSide}>
            {action}
          </div>
        )}
      </section>
    </Panel>
  );
}
