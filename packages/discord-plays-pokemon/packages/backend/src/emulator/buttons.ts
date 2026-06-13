import type { Command } from "#src/game/command/command.ts";
import {
  isLeft,
  isRight,
  isUp,
  isDown,
  isA,
  isB,
  isSelect,
  isStart,
} from "#src/game/command/command.ts";
import { BUTTON } from "./constants.ts";

// Translate a parsed Command into its GBA button bitmask. Replaces the
// Selenium keyboard mapping in keybinds.ts (toGameboyAdvanceKeyInput).
// Note: in this app's grammar `l`/`r` are aliases for left/right, not the
// shoulder buttons, so only the d-pad + face/menu buttons are reachable.
export function commandToButtonMask(command: Command): number {
  if (isLeft(command)) return BUTTON.left;
  if (isRight(command)) return BUTTON.right;
  if (isUp(command)) return BUTTON.up;
  if (isDown(command)) return BUTTON.down;
  if (isA(command)) return BUTTON.a;
  if (isB(command)) return BUTTON.b;
  if (isSelect(command)) return BUTTON.select;
  if (isStart(command)) return BUTTON.start;
  throw new Error(`illegal command: ${command}`);
}
