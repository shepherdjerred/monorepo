import type { CardinalDirection } from "#src/emulator/engine-observation.ts";
import type { Command } from "#src/game/command/command.ts";

export function commandForDirection(direction: CardinalDirection): Command {
  switch (direction) {
    case "north":
      return "up";
    case "south":
      return "down";
    case "west":
      return "left";
    case "east":
      return "right";
  }
}
