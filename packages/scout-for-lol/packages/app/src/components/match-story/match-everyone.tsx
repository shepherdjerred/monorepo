import { Fold } from "@scout-for-lol/design-system/components/surfaces/fold";
import { ChampionFace } from "@scout-for-lol/design-system/domain/profile/champion-face";
import { AssetIcon } from "@scout-for-lol/design-system/domain/rows/asset-icon";
import { builtItems } from "./match-build.ts";
import {
  championLabel,
  compactNumber,
  displayNameOf,
  riotIdOf,
  type DetailMatch,
  type DetailParticipant,
  type MatchStory,
  type StoryParticipant,
} from "./match-model.ts";

type Team = DetailMatch["teams"][number];

function storyOf(
  story: MatchStory | undefined,
  participant: DetailParticipant,
): StoryParticipant | undefined {
  return story === undefined || participant.participantId === null
    ? undefined
    : story.participants.find(
        (candidate) => candidate.participantId === participant.participantId,
      );
}

function EveryoneRow(props: {
  participant: DetailParticipant;
  story: StoryParticipant | undefined;
}) {
  const { participant } = props;
  const built = builtItems(participant, props.story);
  const skills = props.story?.skillOrder ?? null;
  const name =
    participant.scoutAliases.length > 0
      ? displayNameOf(participant)
      : riotIdOf(participant);
  return (
    <li className="grid gap-2 py-3">
      <span className="flex items-center gap-3">
        <ChampionFace champion={participant.championName} size={36} alt="" />
        <span className="grid min-w-0 leading-snug">
          <b className="truncate font-display text-base">{name}</b>
          <span className="truncate text-scout-subtle">
            {championLabel(participant.championName)}
          </span>
        </span>
      </span>
      <p className="text-scout-subtle">
        {participant.creepScore.toLocaleString("en-US")} minions,{" "}
        {participant.visionScore.toLocaleString("en-US")} vision,{" "}
        {compactNumber(participant.goldEarned)} gold
      </p>
      {built.items.length === 0 ? null : (
        <ul
          className="flex flex-wrap gap-1.5"
          aria-label={built.sequence ? "Items in build order" : "Items"}
        >
          {built.items.map((item, index) => (
            <li key={`${item.label}-${index.toString()}`}>
              <AssetIcon asset={item.asset} label={item.label} />
            </li>
          ))}
        </ul>
      )}
      {skills === null || skills.length === 0 ? null : (
        <p className="text-scout-subtle">
          <span className="font-semibold">Skill order</span>{" "}
          <span className="tabular-nums">{skills.join(" ")}</span>
        </p>
      )}
    </li>
  );
}

/** Everyone's minions, vision, gold, build and skill order, behind one fold. */
export function MatchEveryone(props: {
  teams: readonly Team[];
  story: MatchStory | undefined;
}) {
  return (
    <div className="mt-6">
      <Fold summary="Show more stats">
        <div className="grid gap-x-11 min-[1181px]:grid-cols-2">
          {props.teams.map((team) => (
            <ul key={team.teamId} className="divide-y divide-scout-border">
              {team.participants.map((participant, index) => (
                <EveryoneRow
                  key={
                    participant.participantId ??
                    `${team.teamId.toString()}:${index.toString()}`
                  }
                  participant={participant}
                  story={storyOf(props.story, participant)}
                />
              ))}
            </ul>
          ))}
        </div>
      </Fold>
    </div>
  );
}
