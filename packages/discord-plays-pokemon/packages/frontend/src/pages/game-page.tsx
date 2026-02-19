import type { Status, Player } from "@discord-plays-pokemon/common";
import type { Connection } from "#src/model/connection.ts";
import { Button } from "#src/stories/button.tsx";
import { Card } from "#src/stories/card.tsx";
import { Controls } from "#src/stories/controls.tsx";
import { Keys } from "#src/stories/keys.tsx";
import { Profile } from "#src/stories/profile.tsx";

export function GamePage({
  status,
  connection,
  onKey,
  onScreenshot,
  player,
}: {
  onKey: (key: string) => void;
  onScreenshot: () => void;
  status: Status;
  connection: Connection;
  player: Player;
}) {
  return (
    <>
      <Card title="Status">
        <div>There are {status.playerList.length} others connected</div>
        <div>Your latency is {connection.latency}ms</div>
      </Card>
      <Profile player={player} />
      <Keys onKeyDown={onKey} />
      <Controls />
      <Button onClick={onScreenshot}>Take Screenshot</Button>
    </>
  );
}
