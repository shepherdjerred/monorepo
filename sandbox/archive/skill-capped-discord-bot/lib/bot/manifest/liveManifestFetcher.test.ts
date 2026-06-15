import { getTestData } from "../testUtilities";
import { LiveManifestFetcher } from "./liveManifestFetcher";

describe("extractManifestUrl", () => {
  const fetcher = new LiveManifestFetcher();
  it("returns manifest for real league of legends response", async () => {
    const html = await getTestData("html/leagueOfLegends.html");
    const url = fetcher.extractManifestUrl(html);
    expect(url).toBe(
      "https://lol-content-dumps.s3.amazonaws.com/courses_v2/lol/course_dump_1645790326712.json",
    );
  });
  it("returns manifest for real valorant response", async () => {
    const html = await getTestData("html/valorant.html");
    const url = fetcher.extractManifestUrl(html);
    expect(url).toBe(
      "https://lol-content-dumps.s3.amazonaws.com/courses_v2/valorant/course_dump_1645650286025.json",
    );
  });
  it("returns manifest for real world of warcraft response", async () => {
    const html = await getTestData("html/worldOfWarcraft.html");
    const url = fetcher.extractManifestUrl(html);
    expect(url).toBe(
      "https://lol-content-dumps.s3.amazonaws.com/courses_v2/wow/course_dump_1646009952206.json",
    );
  });
});
