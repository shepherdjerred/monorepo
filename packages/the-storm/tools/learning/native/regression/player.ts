import { z } from "zod";
import type { Capture } from "./capture.ts";
import { connectBot, disconnectBot } from "#e2e/harness/bot.ts";

/** Ordinary joined player and lobby kit selection; never a demonstration source. */
export async function joinTrooper({ paper, fixture, cleanup, save }: Capture) {
  const player = await connectBot({
    ...paper.playerAddress,
    username: "RwfRegression",
  });
  let connected = true;
  const disconnect = async () => {
    if (connected) {
      connected = false;
      await disconnectBot(player);
    }
  };
  cleanup.push(disconnect);
  const messages: string[] = [];
  player.on("messagestr", (message: string) => {
    messages.push(message);
  });
  cleanup.push(async () => {
    await save("player-transcript.json", {
      source: "automated-regression-client",
      messages,
    });
  });
  const id = z.uuid().parse(player.player.uuid);
  await fixture.command(`player ${id}`);
  player.chat("/rwf join");
  const deadline = Date.now() + 30_000;
  let state = await fixture.command("sample");
  while (state.phase !== "COUNTDOWN") {
    if (Date.now() >= deadline || state.phase === "LIVE")
      throw new Error("Original player countdown missing");
    await Bun.sleep(100);
    state = await fixture.command("sample");
  }
  await fixture.command("prepare");
  while (state.phase !== "LIVE") {
    if (Date.now() >= deadline)
      throw new Error("Original player case did not start");
    await Bun.sleep(100);
    state = await fixture.command("sample");
  }
  await save("player.json", {
    schema: 1,
    source: "automated-regression-client",
    player: id,
    command: "/rwf join",
    preparedKits: "trooper",
    humanDemonstration: false,
  });
  return { player, id, state, disconnect };
}
