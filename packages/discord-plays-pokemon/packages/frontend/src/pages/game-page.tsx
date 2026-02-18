import type { Status, Player } from "@discord-plays-pokemon/common";
import type { Connection } from "@shepherdjerred/discord-plays-pokemon/packages/frontend/src/model/Connection";
import { Button } from "@shepherdjerred/discord-plays-pokemon/packages/frontend/src/stories/Button";
import { Card } from "@shepherdjerred/discord-plays-pokemon/packages/frontend/src/stories/Card";
import { Controls } from "@shepherdjerred/discord-plays-pokemon/packages/frontend/src/stories/Controls";
import { Keys } from "@shepherdjerred/discord-plays-pokemon/packages/frontend/src/stories/Keys";
import { Profile } from "@shepherdjerred/discord-plays-pokemon/packages/frontend/src/stories/Profile";

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
