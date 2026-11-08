import { describe, onTestFinished } from "vitest";
import { test } from "#e2e/fixtures.ts";
import { connectBot, disconnectBot, waitForMessage } from "#e2e/harness/bot.ts";

describe.skipIf(Bun.env["STORM_E2E_HISTORICAL_TOWNS"] !== "1")(
  "historical town owner",
  () => {
    test("can see the imported town and invite a resident", async ({
      server,
    }) => {
      const owner = await connectBot({
        host: server.host,
        port: server.gamePort,
        username: "HistoryTownA",
      });
      onTestFinished(async () => disconnectBot(owner));
      const resident = await connectBot({
        host: server.host,
        port: server.gamePort,
        username: "HistoryTownB",
      });
      onTestFinished(async () => disconnectBot(resident));
      const info = waitForMessage(owner, /OldTown:/);
      owner.chat("/town");
      await info;
      const invite = waitForMessage(
        resident,
        /HistoryTownA invited you to OldTown/,
      );
      owner.chat("/town invite HistoryTownB");
      await invite;
      const joined = waitForMessage(resident, /You joined OldTown/);
      resident.chat("/town accept OldTown");
      await joined;
      const renamed = waitForMessage(owner, /Your town is now called NewTown/);
      owner.chat("/town rename NewTown");
      await renamed;
      const renamedInfo = waitForMessage(owner, /NewTown \[PLAYER\]/);
      owner.chat("/town info NewTown");
      await renamedInfo;
      const historicalInfo = waitForMessage(owner, /NewTown \[PLAYER\]/);
      owner.chat("/town info OldTown");
      await historicalInfo;
    });
  },
);
