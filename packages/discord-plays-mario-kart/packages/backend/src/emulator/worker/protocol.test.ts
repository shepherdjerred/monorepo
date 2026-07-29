import { describe, expect, it } from "bun:test";
import { parseMainMessage } from "./protocol.ts";

describe("emulator worker flow-control messages", () => {
  it("accepts pause and resume commands", () => {
    expect(parseMainMessage({ kind: "pause" })).toEqual({ kind: "pause" });
    expect(parseMainMessage({ kind: "resume" })).toEqual({ kind: "resume" });
  });
});
