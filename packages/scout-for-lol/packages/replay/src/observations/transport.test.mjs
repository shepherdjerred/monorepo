import { expect, test } from "vitest";
import { openReplay } from "./transport.mjs";

function winnerFromFooter(outcomes) {
  const build = Buffer.from("16.23.840.6595");
  const header = Buffer.alloc(15);
  header.write("RIOT");
  header.writeUInt16LE(2, 4);
  Buffer.from("8bbfcd5af2bc92db", "hex").copy(header, 6);
  header[14] = build.length;
  const stats = Array.from({ length: 10 }, (_, index) => ({
    SKIN: `Champion${index}`,
    TEAM: index < 5 ? "100" : "200",
    WIN: outcomes[index],
  }));
  const footer = Buffer.from(
    JSON.stringify({
      gameLength: 1000,
      statsJson: JSON.stringify(stats),
    }),
  );
  const length = Buffer.alloc(4);
  length.writeUInt32LE(footer.length);
  const bytes = Uint8Array.from(
    Buffer.concat([header, build, Buffer.alloc(256), footer, length]),
  );
  return openReplay(bytes.buffer).winningTeam;
}

test("replay result requires consistent footer outcomes from both teams", () => {
  const outcomes = [
    "Fail",
    "Fail",
    "LeaverFail",
    "Fail",
    "Fail",
    "Win",
    "Win",
    "Win",
    "Win",
    "Win",
  ];
  expect(winnerFromFooter(outcomes)).toBe(200);
  expect(winnerFromFooter(outcomes.toReversed())).toBe(100);
  expect(winnerFromFooter(["Win", ...outcomes.slice(1)])).toBeNull();
  expect(winnerFromFooter([])).toBeNull();
});
