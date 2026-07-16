import { describe, expect, test } from "bun:test";
import {
  extractActionIdCandidates,
  extractSummoners,
  opggSearch,
} from "#src/lib/riot/opgg-search.ts";
import { parseRiotId } from "#src/lib/riot/summoner-index.ts";

describe("extractSummoners", () => {
  test("parses the summoners line (incl. thumbnail) out of an RSC stream", () => {
    const body = [
      '0:{"a":"$@1","f":"","b":"1781900107"}',
      '1:{"summoners":[{"href":"/summoners/na/sjerred-sjerr","gameName":"sjerred","tagline":"sjerr","thumbnail":"https://opgg-static.akamaized.net/x/profileIcon29.jpg","ranked":"PLATINUM 4 - 60LP","teamInfo":null}],"champions":[]}',
    ].join("\n");
    const result = extractSummoners(body);
    expect(result).toHaveLength(1);
    expect(result[0]?.gameName).toBe("sjerred");
    expect(result[0]?.tagline).toBe("sjerr");
    expect(result[0]?.ranked).toBe("PLATINUM 4 - 60LP");
    expect(result[0]?.thumbnail).toBe(
      "https://opgg-static.akamaized.net/x/profileIcon29.jpg",
    );
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

describe("extractActionIdCandidates", () => {
  test("extracts ids from createServerReference(...) calls only", () => {
    const js =
      'var x=(0,a.createServerReference)("402c9587dc35c9a189a48efae20bebb24826369a95",a.callServer);' +
      'let y=(0,a.createServerReference)("40e89b0ba7550f6dd262a35915de9e918e98f4baf4",a.callServer);';
    const ids = extractActionIdCandidates(js);
    expect(ids).toContain("402c9587dc35c9a189a48efae20bebb24826369a95");
    expect(ids).toContain("40e89b0ba7550f6dd262a35915de9e918e98f4baf4");
    expect(ids).toHaveLength(2);
  });

  test("ignores unrelated long-hex literals (not action ids)", () => {
    const js = 'const sha="abcdef0123456789abcdef0123456789abcdef01";';
    expect(extractActionIdCandidates(js)).toEqual([]);
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
