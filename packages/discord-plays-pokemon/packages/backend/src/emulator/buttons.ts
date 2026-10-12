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
  isLeftShoulder,
  isRightShoulder,
} from "#src/game/command/command.ts";
import { BUTTON } from "./constants.ts";

// Translate a parsed Command into its GBA button bitmask. Replaces the
// Selenium keyboard mapping in keybinds.ts (toGameboyAdvanceKeyInput).
// Note: in this app's grammar `l`/`r` are aliases for left/right; the shoulder
// buttons are `lb`/`rb`.
export function commandToButtonMask(command: Command): number {
  if (isLeft(command)) return BUTTON.left;
  if (isRight(command)) return BUTTON.right;
  if (isUp(command)) return BUTTON.up;
  if (isDown(command)) return BUTTON.down;
  if (isA(command)) return BUTTON.a;
  if (isB(command)) return BUTTON.b;
  if (isSelect(command)) return BUTTON.select;
  if (isStart(command)) return BUTTON.start;
  if (isLeftShoulder(command)) return BUTTON.l;
  if (isRightShoulder(command)) return BUTTON.r;
  throw new Error(`illegal command: ${command}`);
}
