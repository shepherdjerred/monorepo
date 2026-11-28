import { ChampionPortrait } from "#src/assets/index.tsx";
import { cn } from "#src/lib/cn.ts";

/** The diameters the redesigned pages use, in CSS pixels. */
export const CHAMPION_FACE_SIZES = [26, 36, 40, 46, 72, 76, 92] as const;
export type ChampionFaceSize = (typeof CHAMPION_FACE_SIZES)[number];

export type ChampionFaceResult = "win" | "loss";

const RESULT_LABEL: Record<ChampionFaceResult, string> = {
  win: "Won",
  loss: "Lost",
};

export type ChampionFaceProps = {
  /** Champion key, name or numeric id, as the asset helpers accept. */
  champion: string | number;
  size?: ChampionFaceSize;
  /** A small mark on the lower right: a check for a win, a dash for a loss. */
  result?: ChampionFaceResult;
  /** Defaults to the champion's name. Pass "" when the name is beside it. */
  alt?: string;
  className?: string;
};

/**
 * A round champion portrait, with an optional result mark. A face is always a
 * face: a champion here, a person in `PersonInitial`.
 *
 * Rows that change the ground colour on hover set `--scout-face-ground` so the
 * ring around the mark follows it.
 */
export function ChampionFace({
  champion,
  size = 46,
  result,
  alt,
  className,
}: ChampionFaceProps) {
  return (
    <span className={cn("scout-face", className)} data-size={size}>
      <ChampionPortrait
        champion={champion}
        {...(alt === undefined ? {} : { alt })}
        className="scout-face__image"
      />
      {result === undefined ? null : (
        <span className="scout-face__mark" data-result={result}>
          {result === "win" ? (
            <svg
              aria-hidden="true"
              width="12"
              height="12"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m5 10.5 3.2 3.2L15 6.5" />
            </svg>
          ) : null}
          <span className="scout-sr-only">{RESULT_LABEL[result]}</span>
        </span>
      )}
    </span>
  );
}
