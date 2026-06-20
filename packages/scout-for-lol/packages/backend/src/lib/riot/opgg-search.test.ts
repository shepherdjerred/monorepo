import { describe, expect, test } from "bun:test";
import { extractSummoners, opggSearch } from "#src/lib/riot/opgg-search.ts";
import { parseRiotId } from "#src/lib/riot/summoner-index.ts";

describe("extractSummoners", () => {
  test("parses the summoners line out of an RSC stream", () => {
    const body = [
      '0:{"a":"$@1","f":"","b":"1781900107"}',
      '1:{"summoners":[{"href":"/summoners/na/sjerred-sjerr","gameName":"sjerred","tagline":"sjerr","ranked":"PLATINUM 4 - 60LP","teamInfo":null}],"champions":[]}',
    ].join("\n");
    const result = extractSummoners(body);
    expect(result).toHaveLength(1);
    expect(result[0]?.gameName).toBe("sjerred");
    expect(result[0]?.tagline).toBe("sjerr");
    expect(result[0]?.ranked).toBe("PLATINUM 4 - 60LP");
  });

  test("returns [] when no summoners line is present", () => {
    expect(extractSummoners('0:{"a":"$@1"}')).toEqual([]);
  });

  test("returns [] on malformed / empty input", () => {
    expect(extractSummoners("not json at all")).toEqual([]);
    expect(extractSummoners("")).toEqual([]);
  });

  test("tolerates unranked summoners (missing/null ranked)", () => {
    const body =
      '1:{"summoners":[{"gameName":"abc","tagline":"NA1","ranked":null}],"champions":[]}';
    const result = extractSummoners(body);
    expect(result[0]?.ranked ?? null).toBeNull();
  });
});

describe("opggSearch (fail-soft short-circuits)", () => {
  test("returns [] for a too-short query without hitting the network", async () => {
    expect(await opggSearch("a", "AMERICA_NORTH")).toEqual([]);
  });

  test("returns [] for an unmappable region without hitting the network", async () => {
    expect(await opggSearch("faker", "NOT_A_REGION")).toEqual([]);
  });
});

describe("parseRiotId", () => {
  test("splits on the last #", () => {
    expect(parseRiotId("sjerred#sjerr")).toEqual({
      gameName: "sjerred",
      tagLine: "sjerr",
    });
  });

  test("rejects values without a usable tag", () => {
    expect(parseRiotId("noTag")).toBeNull();
    expect(parseRiotId("#tagOnly")).toBeNull();
    expect(parseRiotId("nameOnly#")).toBeNull();
  });
});
