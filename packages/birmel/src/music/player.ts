import { Player } from "discord-player";
import { getDiscordClient } from "../discord/index.js";
import { registerExtractors } from "./extractors.js";
import { setupPlayerEvents } from "./events.js";

let player: Player | null = null;
let initialized = false;

export function getMusicPlayer(): Player {
  if (player == null) {
    const client = getDiscordClient();
    player = new Player(client);
  }
  return player;
}

export async function initializeMusicPlayer(): Promise<void> {
  if (initialized) {
    return;
  }

  const playerInstance = getMusicPlayer();
  await registerExtractors(playerInstance);
  setupPlayerEvents(playerInstance);
  initialized = true;
}

export async function destroyMusicPlayer(): Promise<void> {
  if (player != null) {
    await player.destroy();
    player = null;
    initialized = false;
  }
}
