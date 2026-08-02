import { expect, test } from "bun:test";
import { Children, isValidElement, type ReactNode } from "react";
import { LoadingScreenDataSchema } from "@scout-for-lol/data";
import { LoadingScreen } from "#src/html/loading-screen/loading-screen.tsx";
import { getLoadingScreenCanvasDimensions } from "#src/html/loading-screen/index.tsx";
import { StandardLayout } from "#src/html/loading-screen/standard-layout.tsx";

const currentDir = new URL(".", import.meta.url).pathname;

async function loadFixture(fileName: string) {
  const raw: unknown = await Bun.file(
    `${currentDir}testdata/${fileName}`,
  ).json();
  return LoadingScreenDataSchema.parse(raw);
}

test("ARAM Mayhem uses the standard ARAM report layout", async () => {
  const ranked = await loadFixture("ranked-flex-5v5.json");
  const participants = ranked.participants.map((participant) => {
    if ("lane" in participant) {
      const { lane: _lane, ...nonStandardParticipant } = participant;
      return nonStandardParticipant;
    }
    return participant;
  });
  const data = LoadingScreenDataSchema.parse({
    ...ranked,
    queueType: "aram mayhem",
    queueDisplayName: "ARAM: Mayhem",
    layout: "aram",
    mapName: "The Bandlewood",
    bans: [],
    participants,
  });
  if (data.layout !== "aram") {
    throw new Error("Expected ARAM loading screen data");
  }

  const loadingScreen = LoadingScreen({ data });
  if (!isValidElement<{ children: ReactNode }>(loadingScreen)) {
    throw new Error("Loading screen did not return a React element");
  }
  const layout = Children.toArray(loadingScreen.props.children)[1];
  if (!isValidElement(layout)) {
    throw new Error("Loading screen did not return a layout element");
  }

  expect(layout.type).toBe(StandardLayout);
  expect(getLoadingScreenCanvasDimensions(data)).toEqual({
    width: 1600,
    height: 1350,
  });
});

test("Classic keeps its isolated report canvas", async () => {
  const ranked = await loadFixture("ranked-flex-5v5.json");
  const blue = ranked.participants.find(
    (participant) => participant.team === "blue",
  );
  const red = ranked.participants.find(
    (participant) => participant.team === "red",
  );
  if (blue === undefined || red === undefined) {
    throw new Error("Ranked fixture is missing a blue or red participant");
  }
  const participants = [blue, red].map((participant) => ({
    puuid: participant.puuid,
    summonerName: participant.summonerName,
    championId: participant.championId,
    championName: participant.championName,
    championDisplayName: participant.championDisplayName,
    team: participant.team,
    spell1Id: participant.spell1Id,
    spell2Id: participant.spell2Id,
    isTrackedPlayer: participant.isTrackedPlayer,
  }));
  const data = LoadingScreenDataSchema.parse({
    gameId: ranked.gameId,
    queueType: "classic",
    queueDisplayName: "League Classic",
    layout: "classic",
    mapName: "Classic Rift",
    participants,
    gameStartTime: ranked.gameStartTime,
  });

  expect(data.layout).toBe("classic");
  expect(getLoadingScreenCanvasDimensions(data)).toEqual({
    width: 1920,
    height: 1280,
  });
});
