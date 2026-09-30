import { Link } from "react-router";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@scout-for-lol/design-system/components/card";
import { ChampionIcon } from "#src/components/match/champion-icon.tsx";
import { formatRiotId } from "#src/lib/format/riot-id-format.ts";

export type ArenaSubteam = {
  subteamId: number;
  participants: {
    participantId: number;
    placement: number | null;
    championName: string;
    riotId: { gameName: string | null; tagLine: string | null };
    selectedPlayer: boolean;
    kills: number;
    deaths: number;
    assists: number;
    augments: { id: number; name: string | null }[];
    scoutAliases?: { playerId: number; alias: string; guildName: string }[];
  }[];
};

export function ArenaSubteams(props: { subteams: ArenaSubteam[] }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {props.subteams.map((subteam) => {
        const first = subteam.participants[0];
        if (first === undefined)
          throw new Error("Arena subteam has no participants");
        return (
          <Card key={subteam.subteamId}>
            <CardHeader>
              <CardTitle>
                {first.placement === null
                  ? "Placement unavailable"
                  : `#${first.placement.toString()} placement`}{" "}
                · Arena team {subteam.subteamId.toString()}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {subteam.participants.map((participant) => (
                <div key={participant.participantId} className="flex gap-2">
                  <ChampionIcon championName={participant.championName} />
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">
                      {formatRiotId(participant.riotId, "Unknown Riot ID")}
                      {participant.selectedPlayer ? " · Selected" : ""}
                    </p>
                    <p className="text-scout-subtle">
                      {participant.kills.toString()} /{" "}
                      {participant.deaths.toString()} /{" "}
                      {participant.assists.toString()}
                    </p>
                    {participant.scoutAliases?.map((alias) => (
                      <p
                        key={alias.playerId}
                        className="text-xs text-scout-subtle"
                      >
                        <Link
                          className="hover:underline"
                          to={`/players/${alias.playerId.toString()}`}
                        >
                          {alias.alias}
                        </Link>{" "}
                        · {alias.guildName}
                      </p>
                    ))}
                    {participant.augments.length > 0 && (
                      <p className="text-xs text-scout-subtle">
                        Augments:{" "}
                        {participant.augments
                          .map(
                            (augment) =>
                              augment.name ?? `#${augment.id.toString()}`,
                          )
                          .join(" · ")}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
