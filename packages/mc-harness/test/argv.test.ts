import { parseArgs } from "node:util";
import { describe, expect, it } from "vitest";
import { normalizeArgv, wantsHelp } from "#protocol/argv.ts";

const OPTIONS = {
  target: { type: "string" },
  world: { type: "string" },
  pos1: { type: "string" },
  pos2: { type: "string" },
  at: { type: "string" },
  out: { type: "string" },
  lines: { type: "string", short: "n" },
  json: { type: "boolean" },
} as const;

function parsed(args: string[]) {
  return parseArgs({
    args: normalizeArgv(args, OPTIONS),
    options: OPTIONS,
    allowPositionals: true,
    strict: true,
  });
}

describe("normalizeArgv", () => {
  it.each<[string, string[], Record<string, unknown>, string[]]>([
    [
      "negative option values",
      [
        "--world",
        "world",
        "--pos1",
        "-1,-46,-4",
        "--pos2",
        "-3,-60,2",
        "//set air",
      ],
      { world: "world", pos1: "-1,-46,-4", pos2: "-3,-60,2" },
      ["//set air"],
    ],
    [
      "negative positional corners",
      ["read", "--world", "world", "-6,-61,-6", "6,-44,6", "--out", "f.json"],
      { world: "world", out: "f.json" },
      ["read", "-6,-61,-6", "6,-44,6"],
    ],
    [
      "free-text console command with negative numbers",
      ["tp", "agent", "-60", "0", "--target", "sbx-1"],
      { target: "sbx-1" },
      ["tp", "agent", "-60", "0"],
    ],
    [
      "already-attached values and an explicit --",
      ["--at=-5,-64,0", "--json", "--", "--literal"],
      { at: "-5,-64,0", json: true },
      ["--literal"],
    ],
    ["short string options", ["-n", "50"], { lines: "50" }, []],
  ])("%s", (_label, args, values, positionals) => {
    const result = parsed(args);
    expect(result.values).toMatchObject(values);
    expect(result.positionals).toEqual(positionals);
  });

  it("still rejects unknown options", () => {
    expect(() => parsed(["--nope"])).toThrow(/Unknown option/u);
  });
});

describe("wantsHelp", () => {
  it("sees --help/-h only before --", () => {
    expect(wantsHelp(["--world", "w", "--help"])).toBe(true);
    expect(wantsHelp(["-h"])).toBe(true);
    expect(wantsHelp(["--", "-h"])).toBe(false);
    expect(wantsHelp(["say", "hi"])).toBe(false);
  });
});
