import { championNameToDisplayName } from "@scout-for-lol/data";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { ChampionIcon } from "#src/components/match/champion-icon.tsx";

export type MatchMvpTallyReason = {
  voterName: string;
  justification: string;
};

export type MatchMvpTallyNominee = {
  displayName: string;
  championName: string;
  voteCount: number;
  reasons: MatchMvpTallyReason[];
};

export type MatchMvpTallyGuild = {
  guildId: string;
  guildName: string;
  blue: MatchMvpTallyNominee[];
  red: MatchMvpTallyNominee[];
};

export type MatchMvpTallyView = {
  showGuildNames: boolean;
  guilds: MatchMvpTallyGuild[];
};

function SideList(props: {
  label: string;
  nominees: readonly MatchMvpTallyNominee[];
}) {
  if (props.nominees.length === 0) {
    return null;
  }
  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold">{props.label}</h3>
      <ul className="space-y-2">
        {props.nominees.map((nominee) => (
          <li key={`${nominee.displayName}:${nominee.championName}`}>
            <div className="flex items-center gap-2">
              <ChampionIcon championName={nominee.championName} size="sm" />
              <span className="font-medium">
                {nominee.displayName} (
                {championNameToDisplayName(nominee.championName)})
              </span>
              <span className="text-sm text-scout-subtle">
                {nominee.voteCount.toString()}{" "}
                {nominee.voteCount === 1 ? "vote" : "votes"}
              </span>
            </div>
            {nominee.reasons.length > 0 && (
              <ul className="mt-1 space-y-1 pl-10 text-sm text-scout-subtle">
                {nominee.reasons.map((reason) => (
                  <li key={`${reason.voterName}:${reason.justification}`}>
                    “{reason.justification}” — {reason.voterName}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function GuildTally(props: {
  guild: MatchMvpTallyGuild;
  showGuildName: boolean;
}) {
  return (
    <div className="space-y-4">
      {props.showGuildName && (
        <p className="text-sm font-medium">{props.guild.guildName}</p>
      )}
      <SideList label="Blue MVP" nominees={props.guild.blue} />
      <SideList label="Red MVP" nominees={props.guild.red} />
    </div>
  );
}

export function MatchMvpTally(props: { tally: MatchMvpTallyView }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Community MVP votes</CardTitle>
        <CardDescription>
          Discord ballots from your servers. Voting stays in Discord.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {props.tally.guilds.map((guild) => (
          <GuildTally
            key={guild.guildId}
            guild={guild}
            showGuildName={props.tally.showGuildNames}
          />
        ))}
      </CardContent>
    </Card>
  );
}
