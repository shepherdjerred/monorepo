import Site from "./site";
import { siteToString, stringToSite } from "./utilities";

describe("utilities", () => {
  describe("siteToString", () => {
    it("should return the correct string for league of legends", () => {
      const result = siteToString(Site.LEAGUE_OF_LEGENDS);
      const expected = "leagueOfLegends";
      expect(result).toBe(expected);
    });
    it("should return the correct string for valorant", () => {
      const result = siteToString(Site.VALORANT);
      const expected = "valorant";
      expect(result).toBe(expected);
    });
    it("should return the correct string for world of warcraft", () => {
      const result = siteToString(Site.WORLD_OF_WARCRAFT);
      const expected = "worldOfWarcraft";
      expect(result).toBe(expected);
    });
  });
  describe("stringToSite", () => {
    it("should return the correct site for league of legends", () => {
      const result = stringToSite("leagueOfLegends");
      const expected = Site.LEAGUE_OF_LEGENDS;
      expect(result).toBe(expected);
    });
    it("should return the correct site for valorant", () => {
      const result = stringToSite("valorant");
      const expected = Site.VALORANT;
      expect(result).toBe(expected);
    });
    it("should return the correct site for world of warcraft", () => {
      const result = stringToSite("worldOfWarcraft");
      const expected = Site.WORLD_OF_WARCRAFT;
      expect(result).toBe(expected);
    });
  });
});
