import { cn } from "#src/lib/cn.ts";
import { ChampionFace } from "#src/domain/profile/champion-face.tsx";
import { PersonInitial } from "#src/domain/profile/person-initial.tsx";
import { Spark } from "./spark.tsx";

export type StickerWho =
  { person: string; you?: boolean } | { champion: string | number };

export type StickerProps = {
  /** The award: "Biggest climb". */
  title: string;
  /** Who got it and the number: "Northstar, +63 LP". */
  detail: string;
  /** The face on the left: a person, or a champion. */
  who: StickerWho;
  href?: string;
  className?: string;
};

/** A weekly award: a face with a spark, the award, then who and how much. */
export function Sticker({ title, detail, who, href, className }: StickerProps) {
  const content = (
    <>
      <span className="scout-sticker__face">
        {"person" in who ? (
          <PersonInitial name={who.person} you={who.you ?? false} />
        ) : (
          <ChampionFace champion={who.champion} alt="" />
        )}
        <span className="scout-sticker__mark">
          <Spark size={11} />
        </span>
      </span>
      <span className="scout-sticker__text">
        <b>{title}</b>
        <span>{detail}</span>
      </span>
    </>
  );
  const classes = cn("scout-sticker", className);
  return href === undefined ? (
    <div className={classes}>{content}</div>
  ) : (
    <a className={classes} href={href}>
      {content}
    </a>
  );
}
