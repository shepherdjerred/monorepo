import { describe, expect, test } from "vitest";
import contract from "@shepherdjerred/the-storm/public-status.json";
import { publicQueryMetadata } from "#e2e/harness/public-status.ts";

const UUID = "11111111-1111-4111-8111-111111111111";
const PLAYER = { name: "Player_1", uuid: UUID };
const GAME = {
  id: "arena",
  kind: "ARENA",
  name: "Arena",
  phase: "RUNNING",
  progress: "Round 1",
  players: [UUID],
};
const METADATA = { schemaVersion: 2, players: [PLAYER], games: [GAME] };

function wire(value: unknown) {
  const encoded = Buffer.from(JSON.stringify(value), "utf8").toString(
    "base64url",
  );
  return `Paper on 26.2: ${contract.queryIdentity}|${encoded} `;
}

describe("independent native public Query metadata acceptance", () => {
  test("decodes the canonical sole application entry", () => {
    expect(publicQueryMetadata(wire(METADATA))).toEqual({
      identity: contract.queryIdentity,
      metadata: METADATA,
    });
  });

  test.each([
    ["empty game ID", { ...GAME, id: "" }],
    ["oversized game ID", { ...GAME, id: "x".repeat(65) }],
    ["empty game label", { ...GAME, name: "" }],
    ["oversized game label", { ...GAME, name: "x".repeat(65) }],
    ["unknown game phase", { ...GAME, phase: "PRIVATE" }],
    ["unknown game kind", { ...GAME, kind: "SECRET" }],
    ["empty participant list", { ...GAME, players: [] }],
    ["repeated participant", { ...GAME, players: [UUID, UUID] }],
    ["private game field", { ...GAME, internalMap: "private" }],
  ])("refuses %s", (_, game) => {
    expect(() =>
      publicQueryMetadata(wire({ ...METADATA, games: [game] })),
    ).toThrow();
  });

  test.each([
    ["obsolete schema", { ...METADATA, schemaVersion: 1 }],
    ["private root field", { ...METADATA, plugins: ["private"] }],
    [
      "repeated player name",
      {
        ...METADATA,
        players: [
          PLAYER,
          { ...PLAYER, uuid: "22222222-2222-4222-8222-222222222222" },
        ],
      },
    ],
    [
      "repeated player UUID",
      { ...METADATA, players: [PLAYER, { ...PLAYER, name: "Player_2" }] },
    ],
    [
      "control-bearing player name",
      { ...METADATA, players: [{ ...PLAYER, name: "Player\n1" }] },
    ],
    [
      "markup-bearing player name",
      { ...METADATA, players: [{ ...PLAYER, name: "<hidden>" }] },
    ],
  ])("refuses %s", (_, value) => {
    expect(() => publicQueryMetadata(wire(value))).toThrow();
  });

  test.each([
    "Vanilla: ",
    "Paper on 26.2; PrivatePlugin: ",
    "Paper on 26.2: PrivatePlugin; ",
  ])("refuses additional or unsupported plugin wrapping: %s", (prefix) => {
    const application = wire(METADATA).slice("Paper on 26.2: ".length);
    expect(() => publicQueryMetadata(prefix + application)).toThrow();
  });

  test("refuses padded and noncanonical base64url instead of silently normalizing it", () => {
    const valid = wire(METADATA);
    expect(() => publicQueryMetadata(valid.slice(0, -1) + "= ")).toThrow();
    const encoded = Buffer.from("{}", "utf8").toString("base64url");
    expect(encoded).toBe("e30");
    // Both strings decode to {}, but e31 sets unused padding bits.
    expect(Buffer.from("e31", "base64url")).toEqual(
      Buffer.from(encoded, "base64url"),
    );
    expect(() =>
      publicQueryMetadata(`Paper on 26.2: ${contract.queryIdentity}|e31 `),
    ).toThrow("Noncanonical public Query metadata encoding");
  });
});
