import { DiscordGuildIdSchema } from "@scout-for-lol/data";
import { describe, expect, test } from "vitest";
import { toggleServer } from "#src/lib/champions/server-selection.ts";

const RIFT = DiscordGuildIdSchema.parse("1337623164146155593");
const MIDNIGHT = DiscordGuildIdSchema.parse("1337623164146155594");
const SERVERS = [
  { guildId: RIFT, name: "Rift Study Group" },
  { guildId: MIDNIGHT, name: "Midnight Scrims" },
];

describe("toggleServer", () => {
  test("turning one server off narrows the selection", () => {
    expect(toggleServer(SERVERS, undefined, MIDNIGHT)).toEqual([RIFT]);
  });

  test("turning it back on returns to the default selection", () => {
    expect(toggleServer(SERVERS, [RIFT], MIDNIGHT)).toBeUndefined();
  });

  test("the last selected server cannot be turned off", () => {
    expect(toggleServer(SERVERS, [RIFT], RIFT)).toEqual([RIFT]);
  });
});
