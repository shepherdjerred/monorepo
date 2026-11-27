import { ChampionSplashArt } from "#src/assets/index.tsx";
import { cn } from "#src/lib/cn.ts";

/** The way the champion in a piece of art looks. */
export type ArtFace = "left" | "right";

export type HeroArt = {
  /** Champion key, name or numeric id. */
  champion: string | number;
  /** Decorative by default: the hero's words already name the champion. */
  alt?: string;
  /**
   * The direction the champion in the source art faces. A hero wants its
   * champion to look toward the words, so art that faces away is mirrored.
   * Left out when it is not known; the art is then shown as it is.
   */
  face?: ArtFace;
  /** Forces the mirror on or off, whatever `face` says. */
  mirrored?: boolean;
};

/** The side of the hero a champion sits on. */
export type ArtSide = "start" | "end";

/**
 * Whether art on `side` is flipped. A champion at the start looks right, toward
 * the middle; one at the end looks left. An explicit `mirrored` wins; with
 * neither it and `face`, the art is left as it is.
 */
export function isArtMirrored(art: HeroArt, side: ArtSide): boolean {
  if (art.mirrored !== undefined) return art.mirrored;
  if (art.face === undefined) return false;
  const wanted: ArtFace = side === "start" ? "right" : "left";
  return art.face !== wanted;
}

/** One champion fading in from a side of a hero. Position and mask are CSS. */
export function HeroArtImage({
  art,
  side,
  className,
}: {
  art: HeroArt;
  side: ArtSide;
  className?: string;
}) {
  return (
    <div
      className={cn("scout-hero-art", className)}
      data-side={side}
      data-mirrored={isArtMirrored(art, side) ? "true" : "false"}
    >
      <ChampionSplashArt champion={art.champion} alt={art.alt ?? ""} />
    </div>
  );
}
