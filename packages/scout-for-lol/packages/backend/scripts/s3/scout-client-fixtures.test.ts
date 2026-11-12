import { readdir } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  bundleKey,
  FixtureCliConfigSchema,
  redactClientBundle,
} from "./scout-client-fixtures.ts";

const FIXTURE_DIRECTORY = new URL("../../../../testdata/lcu/", import.meta.url);
const FAKE_UUID_PATTERN =
  /^(5c0a7000-0000-4000-8000-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000)$/;
const ANY_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PUUID_PATTERN = /[A-Za-z0-9_-]{78}/;
const NAME_KEYS = new Set(["gameName", "riotIdGameName", "summonerName"]);
const TAG_KEYS = new Set(["tagLine", "riotIdTagLine"]);

type Finding = { path: string; problem: string };

function scan(value: unknown, path: string, findings: Finding[]): void {
  if (Array.isArray(value)) {
    value.forEach((item: unknown, index) => {
      scan(item, `${path}[${String(index)}]`, findings);
    });
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (typeof child === "string") {
        if (NAME_KEYS.has(key) && !/^(Player\d+)?$/.test(child)) {
          findings.push({ path: childPath, problem: "real-looking name" });
        }
        if (TAG_KEYS.has(key) && child !== "" && child !== "TEST") {
          findings.push({ path: childPath, problem: "real-looking tag line" });
        }
      }
      scan(child, childPath, findings);
    }
    return;
  }
  if (typeof value !== "string") {
    return;
  }
  if (PUUID_PATTERN.test(value)) {
    findings.push({ path, problem: "78-character PUUID" });
  }
  if (ANY_UUID_PATTERN.test(value) && !FAKE_UUID_PATTERN.test(value)) {
    findings.push({ path, problem: "UUID that is not a stable fake" });
  }
  if (/^\S+#[A-Za-z0-9]{3,5}$/.test(value) && !value.endsWith("#TEST")) {
    findings.push({ path, problem: "real-looking Riot ID" });
  }
}

describe("committed Scout Client fixtures", () => {
  test("hold no real PUUID, Riot ID, name or credential", async () => {
    const files = (await readdir(FIXTURE_DIRECTORY)).filter((name) =>
      name.endsWith(".json"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const raw: unknown = await Bun.file(
        new URL(file, FIXTURE_DIRECTORY),
      ).json();
      const findings: Finding[] = [];
      scan(raw, file, findings);
      expect(findings, file).toEqual([]);
      expect(JSON.stringify(raw).toLowerCase(), file).not.toMatch(
        /"[^"]*(password|jwt|secret|accesstoken)[^"]*":/,
      );
    }
  });
});

function syntheticBundle() {
  const realUuid = "3cc4e852-c209-5e0d-88ac-e61b0ad507c6";
  const otherUuid = "22d8ffb5-a31d-5f99-9f87-9503d7299387";
  return {
    resource: "post_game",
    data: {
      matchHistory: {
        participantIdentities: [
          {
            participantId: 1,
            player: {
              puuid: otherUuid,
              gameName: "RealOther",
              summonerName: "RealOther",
              tagLine: "NA1",
              summonerId: 124124645,
            },
          },
          {
            participantId: 2,
            player: {
              puuid: realUuid,
              gameName: "RealLocal",
              summonerName: "",
              tagLine: "ABC",
              summonerId: 20493912,
            },
          },
        ],
      },
      endOfGame: {
        multiUserChatPassword: "hunter2",
        localPlayer: {
          puuid: realUuid,
          riotIdGameName: "RealLocal",
          riotIdTagLine: "ABC",
          summonerId: 20493912,
        },
        teams: [
          {
            players: [
              {
                puuid: otherUuid,
                riotIdGameName: "RealOther",
                summonerId: 124124645,
              },
            ],
          },
        ],
      },
      timeline: { frames: [{ participantId: 1 }] },
    },
  };
}

describe("redactClientBundle", () => {
  test("replaces identities with stable fakes, local player first", () => {
    const fixture = redactClientBundle(syntheticBundle());
    const text = JSON.stringify(fixture);

    for (const leaked of [
      "3cc4e852",
      "22d8ffb5",
      "RealLocal",
      "RealOther",
      "hunter2",
      "124124645",
      "20493912",
      "multiUserChatPassword",
    ]) {
      expect(text).not.toContain(leaked);
    }
    const eog = z
      .object({
        localPlayer: z.object({
          puuid: z.string(),
          riotIdGameName: z.string(),
          riotIdTagLine: z.string(),
          summonerId: z.number(),
        }),
      })
      .parse(fixture.endOfGame);
    expect(eog.localPlayer).toEqual({
      puuid: "5c0a7000-0000-4000-8000-000000000001",
      riotIdGameName: "Player1",
      riotIdTagLine: "TEST",
      summonerId: 1001,
    });
    expect(text).toContain("Player2");
  });

  test("rejects a bundle that is not a post-game payload", () => {
    expect(() => redactClientBundle({ resource: "lobby", data: {} })).toThrow();
  });
});

describe("fixture CLI configuration", () => {
  test("derives the archived bundle key from the date and match id", () => {
    const config = FixtureCliConfigSchema.parse({
      bucket: "scout-beta",
      matchId: "NA1_5663121007",
      date: "2026-10-18",
      name: "classic",
    });
    expect(bundleKey(config)).toBe(
      "games/2026/10/18/NA1_5663121007/client-bundle.json",
    );
  });
});
