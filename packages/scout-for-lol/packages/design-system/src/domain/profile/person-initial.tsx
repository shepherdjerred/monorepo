import { ChampionPortrait } from "#src/assets/index.tsx";
import { cn } from "#src/lib/cn.ts";

export type PersonInitialSize = "s" | "m" | "l";

const FIRST_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

function firstGrapheme(text: string): string | undefined {
  for (const part of new Intl.Segmenter().segment(text)) return part.segment;
  return undefined;
}

/**
 * The letter a person's disc shows: the first letter or digit of the name, so
 * "@Northstar" and "#river" read as N and R. A name with neither (all symbols
 * or emoji) falls back to its first character.
 */
export function initialOf(name: string): string {
  const trimmed = name.trim();
  const letter = FIRST_LETTER_OR_DIGIT.exec(trimmed)?.[0];
  const first = letter ?? firstGrapheme(trimmed);
  return first === undefined ? "?" : first.toLocaleUpperCase();
}

export type PersonInitialProps = {
  name: string;
  size?: PersonInitialSize;
  /** The signed-in viewer: the disc takes the brand colour. */
  you?: boolean;
  /** A dot for someone in a game right now. */
  live?: boolean;
  /** A small champion badge on the lower right. */
  champion?: string | number;
  className?: string;
};

/**
 * A round initial for a person. The disc is decorative because the name always
 * sits beside it; `live` adds its own text for assistive technology.
 */
export function PersonInitial({
  name,
  size = "m",
  you = false,
  live = false,
  champion,
  className,
}: PersonInitialProps) {
  return (
    <span
      className={cn("scout-person", className)}
      data-size={size}
      data-you={you ? "true" : undefined}
    >
      <span className="scout-person__initial" aria-hidden="true">
        {initialOf(name)}
      </span>
      {live ? (
        <span className="scout-person__live">
          <span className="scout-sr-only">In a game now</span>
        </span>
      ) : null}
      {champion === undefined ? null : (
        <ChampionPortrait
          champion={champion}
          alt=""
          className="scout-person__badge"
        />
      )}
    </span>
  );
}
