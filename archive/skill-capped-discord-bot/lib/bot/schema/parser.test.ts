import { getTestJsonData } from "../testUtilities";
import { isUrlValid } from "../urlValidator";
import {
  parseLeagueOfLegends,
  parseValorant,
  parseWorldOfWarcraft,
} from "./parser";
import {
  RawLeagueOfLegendsSchema,
  RawValorantSchema,
  RawWorldOfWarcraftSchema,
} from "./rawSchema";

describe("parseWorldOfWarcraft", () => {
  it("parses real manifest", async () => {
    const rawSchema = (await getTestJsonData(
      "json/worldOfWarcraft.json"
    )) as RawWorldOfWarcraftSchema;
    const schema = parseWorldOfWarcraft(rawSchema);
    expect(schema).toMatchSnapshot();
  });

  it("parses the first video's url correctly", async () => {
    const rawSchema = (await getTestJsonData(
      "json/worldOfWarcraft.json"
    )) as RawWorldOfWarcraftSchema;
    const schema = parseWorldOfWarcraft(rawSchema);
    const firstVideo = schema.videos[0];
    const actual = await isUrlValid(firstVideo.url);
    expect(actual).toBe(true);
  });

  it("parses the first video's thumbnail correctly", async () => {
    const rawSchema = (await getTestJsonData(
      "json/worldOfWarcraft.json"
    )) as RawWorldOfWarcraftSchema;
    const schema = parseWorldOfWarcraft(rawSchema);
    const firstVideo = schema.videos[0];
    const actual = await isUrlValid(firstVideo.thumbnail);
    expect(actual).toBe(true);
  });
});

describe("parseValorant", () => {
  it("parses real manifest", async () => {
    const rawSchema = (await getTestJsonData(
      "json/valorant.json"
    )) as RawValorantSchema;
    const schema = parseValorant(rawSchema);
    expect(schema).toMatchSnapshot();
  });
  it("parses the first video's url correctly", async () => {
    const rawSchema = (await getTestJsonData(
      "json/valorant.json"
    )) as RawValorantSchema;
    const schema = parseValorant(rawSchema);
    const firstVideo = schema.videos[0];
    const actual = await isUrlValid(firstVideo.url);
    expect(actual).toBe(true);
  });

  it("parses the first video's thumbnail correctly", async () => {
    const rawSchema = (await getTestJsonData(
      "json/valorant.json"
    )) as RawValorantSchema;
    const schema = parseValorant(rawSchema);
    const firstVideo = schema.videos[0];
    const actual = await isUrlValid(firstVideo.thumbnail);
    expect(actual).toBe(true);
  });
});

describe("parseLeagueOfLegends", () => {
  it("parses real manifest", async () => {
    const rawSchema = (await getTestJsonData(
      "json/leagueOfLegends.json"
    )) as RawLeagueOfLegendsSchema;
    const schema = parseLeagueOfLegends(rawSchema);
    expect(schema).toMatchSnapshot();
  });
  it("parses the first video's url correctly", async () => {
    const rawSchema = (await getTestJsonData(
      "json/leagueOfLegends.json"
    )) as RawLeagueOfLegendsSchema;
    const schema = parseLeagueOfLegends(rawSchema);
    const firstVideo = schema.videos[0];
    const actual = await isUrlValid(firstVideo.url);
    expect(actual).toBe(true);
  });

  it("parses the first video's thumbnail correctly", async () => {
    const rawSchema = (await getTestJsonData(
      "json/leagueOfLegends.json"
    )) as RawLeagueOfLegendsSchema;
    const schema = parseLeagueOfLegends(rawSchema);
    const firstVideo = schema.videos[0];
    const actual = await isUrlValid(firstVideo.thumbnail);
    expect(actual).toBe(true);
  });

  it("parses the first commentary's url correctly", async () => {
    const rawSchema = (await getTestJsonData(
      "json/leagueOfLegends.json"
    )) as RawLeagueOfLegendsSchema;
    const schema = parseLeagueOfLegends(rawSchema);
    const firstVideo = schema.commentaries[0];
    const actual = await isUrlValid(firstVideo.url);
    expect(actual).toBe(true);
  });

  it("parses the first commentary's thumbnail correctly", async () => {
    const rawSchema = (await getTestJsonData(
      "json/leagueOfLegends.json"
    )) as RawLeagueOfLegendsSchema;
    const schema = parseLeagueOfLegends(rawSchema);
    const firstVideo = schema.commentaries[0];
    const actual = await isUrlValid(firstVideo.thumbnail);
    expect(actual).toBe(true);
  });
});
