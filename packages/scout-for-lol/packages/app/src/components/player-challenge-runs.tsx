import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { PlayerId } from "@scout-for-lol/data";
import { Badge } from "@scout-for-lol/design-system/components/badge";
import { Section } from "#src/components/player-detail-sections.tsx";
import { useTRPC } from "#src/lib/trpc.ts";

type ChallengeRunSummary = {
  readonly id: string;
  readonly recomputing: boolean;
  readonly status: string;
  readonly title: string;
};

function ChallengeRunSection(props: {
  runs: readonly ChallengeRunSummary[] | undefined;
}) {
  if (props.runs === undefined || props.runs.length === 0) return null;

  return (
    <Section title="Challenge runs">
      <ul className="grid gap-2 sm:grid-cols-2">
        {props.runs.map((run) => (
          <li key={run.id}>
            <Link
              className="flex items-center justify-between gap-3 rounded-md border p-3 hover:bg-scout-hover"
              to={`/challenge-runs/${run.id}`}
            >
              <span className="font-medium">{run.title}</span>
              <Badge variant="outline">
                {run.recomputing ? "recomputing" : run.status}
              </Badge>
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export function GuildPlayerChallengeRuns(props: {
  guildId: string;
  alias: string;
}) {
  const trpc = useTRPC();
  const challengeRuns = useQuery(
    trpc.challenge.profileRuns.queryOptions(
      { guildId: props.guildId, alias: props.alias },
      { retry: false },
    ),
  );

  return <ChallengeRunSection runs={challengeRuns.data} />;
}

export function ConsumerPlayerChallengeRuns(props: { playerId: PlayerId }) {
  const trpc = useTRPC();
  const challengeRuns = useQuery(
    trpc.challenge.profileRunsByPlayerId.queryOptions(
      { playerId: props.playerId },
      { retry: false },
    ),
  );

  return <ChallengeRunSection runs={challengeRuns.data} />;
}
