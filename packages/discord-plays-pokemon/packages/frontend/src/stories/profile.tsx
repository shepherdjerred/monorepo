import type { Player } from "@discord-plays-pokemon/common";
import { Avatar } from "./avatar.tsx";
import { Button } from "./button.tsx";
import { Card } from "./card.tsx";

export function Profile({ player }: { player: Player }) {
  return (
    <Card title="Profile">
      <Avatar />
      <p>Logged in as {player.discordUsername}</p>
      <Button>Logout</Button>
    </Card>
  );
}
