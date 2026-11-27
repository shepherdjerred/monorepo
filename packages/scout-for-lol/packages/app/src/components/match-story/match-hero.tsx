import { Link } from "react-router";
import { HeroPanel } from "@scout-for-lol/design-system/domain/profile/hero-panel";
import { chipVariants } from "@scout-for-lol/design-system/components/surfaces/chip";
import type { HeroText, DetailParticipant } from "./match-model.ts";

/** Classic champions have no splash art, so their hero is plain. */
function splashFor(championName: string): { champion: string } | undefined {
  return championName.startsWith("Jade_")
    ? undefined
    : { champion: championName };
}

export function MatchHero(props: {
  text: HeroText;
  viewer: DetailParticipant;
  profilePath: string;
}) {
  const art = splashFor(props.viewer.championName);
  return (
    <HeroPanel
      aria-labelledby="match-title"
      {...(art === undefined ? {} : { art })}
    >
      <Link
        to={props.profilePath}
        className={`${chipVariants({ variant: "ghost" })} mb-4 self-start`}
      >
        Back to profile
      </Link>
      <h1
        id="match-title"
        className="font-display text-4xl leading-none font-bold [overflow-wrap:anywhere] sm:text-5xl"
      >
        {props.text.title}
      </h1>
      <p className="mt-3 font-display text-2xl leading-snug sm:text-3xl">
        {props.text.lead}
      </p>
      <p className="mt-3 text-scout-subtle">{props.text.sub}</p>
    </HeroPanel>
  );
}
