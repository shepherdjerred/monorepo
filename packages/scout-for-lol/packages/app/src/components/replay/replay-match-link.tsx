import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { z } from "zod";
import type { RiotMatchIdSchema } from "@scout-for-lol/data";
import { Button } from "@scout-for-lol/design-system/components/button";
import { matchReplayQuery, replayPath } from "#src/lib/replay/api.ts";

/** File availability is public and independent of the match page’s access policy. */
export function ReplayMatchLink(props: {
  matchId: z.input<typeof RiotMatchIdSchema>;
}) {
  const availability = useQuery(matchReplayQuery(props.matchId));
  const replay = availability.data?.replay;
  if (replay == null) return null;
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={replayPath(replay.replayId)}>
        {replay.playback.status === "available"
          ? "Watch replay"
          : "View replay"}
      </Link>
    </Button>
  );
}
