import { describe, expect, test } from "vitest";
import { z } from "zod";
import rawContract from "./voice-cascade.contract.json" with { type: "json" };
import rawFixtures from "./voice-cascade.fixtures.json" with { type: "json" };
import {
  SCOUT_VOICE_CASCADE,
  VoiceCascadeContractSchema,
} from "./voice-cascade.schema.ts";

type Fixture = {
  readonly reason: string;
  readonly path: readonly string[];
  readonly value: unknown;
};

const ObjectSchema = z.record(z.string(), z.unknown());

/** `value` with the entry at `path` replaced, as the Rust reader's tests build it. */
function setAt(
  value: unknown,
  path: readonly string[],
  replacement: unknown,
): unknown {
  const [key, ...rest] = path;
  if (key === undefined) return replacement;
  const object = ObjectSchema.parse(value);
  return { ...object, [key]: setAt(object[key], rest, replacement) };
}

function withOverride(fixture: Fixture): unknown {
  return fixture.path.length === 0
    ? rawContract
    : setAt(rawContract, fixture.path, fixture.value);
}

describe("Scout voice cascade contract", () => {
  test("parses the committed contract", () => {
    expect(SCOUT_VOICE_CASCADE).toEqual(rawContract);
    expect(SCOUT_VOICE_CASCADE.wake.phrases).toContain("hey scout");
  });

  test.each(rawFixtures.valid)("accepts $reason", (fixture) => {
    expect(
      VoiceCascadeContractSchema.safeParse(withOverride(fixture)).success,
    ).toBe(true);
  });

  test.each(rawFixtures.invalid)("rejects $reason", (fixture) => {
    expect(
      VoiceCascadeContractSchema.safeParse(withOverride(fixture)).success,
    ).toBe(false);
  });
});
