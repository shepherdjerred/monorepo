import type { Status, Player } from "@discord-plays-pokemon/common";
import type { Connection } from "../model/connection";
import { Button } from "../stories/button";
import { Card } from "../stories/card";
import { Controls } from "../stories/controls";
import { Keys } from "../stories/keys";
import { Profile } from "../stories/profile";

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
