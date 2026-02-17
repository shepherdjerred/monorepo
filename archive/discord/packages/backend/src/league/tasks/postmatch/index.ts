import { send } from "../../discord/channel.ts";
import { getPlayer } from "../../model/player.ts";
import { getState } from "../../model/state.ts";
import { checkMatch, checkPostMatchInternal, saveMatch } from "./internal.ts";

export async function checkPostMatch() {
  const state = getState();
  return await checkPostMatchInternal(
    state,
    saveMatch,
    checkMatch,
    send,
    getPlayer,
  );
}
