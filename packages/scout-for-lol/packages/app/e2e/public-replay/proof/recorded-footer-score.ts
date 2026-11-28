import { expect, type Page } from "@playwright/test";
import { z } from "zod";

const footerMetadata = z.object({ statsJson: z.string() });
const footerCount = z.string().regex(/^\d+$/).transform(Number);
const footerRoster = z
  .array(
    z.object({
      TEAM: z.enum(["100", "200"]),
      WIN: z.enum(["Win", "Fail", "LeaverFail"]),
      CHAMPIONS_KILLED: footerCount,
      NUM_DEATHS: footerCount,
      ASSISTS: footerCount,
      LEVEL: footerCount,
    }),
  )
  .length(10);

export async function readFooterScores(replayFile: string) {
  const bytes = await Bun.file(replayFile).bytes();
  const end = bytes.length - 4;
  const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(
    end,
    true,
  );
  const metadata = footerMetadata.parse(
    JSON.parse(new TextDecoder().decode(bytes.subarray(end - length, end))),
  );
  const roster = footerRoster.parse(JSON.parse(metadata.statsJson));
  const blue = roster.filter((player) => player.TEAM === "100");
  const red = roster.filter((player) => player.TEAM === "200");
  expect(blue).toHaveLength(5);
  expect(red).toHaveLength(5);
  const blueWon = blue.every((player) => player.WIN === "Win");
  const redWon = red.every((player) => player.WIN === "Win");
  expect(blueWon).not.toBe(redWon);

  return {
    blueKills: blue.reduce(
      (total, player) => total + player.CHAMPIONS_KILLED,
      0,
    ),
    redKills: red.reduce((total, player) => total + player.CHAMPIONS_KILLED, 0),
    winner: blueWon ? "Blue team won" : "Red team won",
    roster: [
      { table: "Blue team roster", players: blue },
      { table: "Red team roster", players: red },
    ],
  };
}

export async function verifyFooterRoster(
  page: Page,
  teams: Awaited<ReturnType<typeof readFooterScores>>["roster"],
) {
  for (const { table, players } of teams) {
    const roster = page.getByRole("table", { name: table });
    const columns = await roster.getByRole("columnheader").allTextContents();
    const stats = ["Kills", "Deaths", "Assists", "Level"];
    const indexes = stats.map((name) => columns.indexOf(name) - 1);
    expect(indexes.every((index) => index >= 0)).toBe(true);
    for (const [index, player] of players.entries()) {
      const cells = await roster
        .getByRole("row")
        .nth(index + 1)
        .getByRole("cell")
        .allTextContents();
      expect(indexes.map((column) => cells[column])).toEqual(
        [
          player.CHAMPIONS_KILLED,
          player.NUM_DEATHS,
          player.ASSISTS,
          player.LEVEL,
        ].map(String),
      );
    }
  }
}
