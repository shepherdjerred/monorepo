import { Player } from "@shepherdjerred/dpp-common";
import { Avatar } from "./Avatar";
import { Button } from "./Button";
import { Card } from "./Card";

export function Profile({ player }: { player: Player }) {
  return (
    <Card title="Profile">
      <Avatar />
      <p>Logged in as {player.discordUsername}</p>
      <Button>Logout</Button>
    </Card>
  );
}
