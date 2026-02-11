import { Status, Player } from "@shepherdjerred/dpp-common";
import { Connection } from "../model/Connection";
import { Button } from "../stories/Button";
import { Card } from "../stories/Card";
import { Controls } from "../stories/Controls";
import { Keys } from "../stories/Keys";
import { Profile } from "../stories/Profile";

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
