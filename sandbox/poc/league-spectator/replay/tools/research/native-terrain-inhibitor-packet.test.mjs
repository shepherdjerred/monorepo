import assert from "node:assert/strict";
import test from "node:test";
import { readCurrentInhibitorPacketState } from "./native-terrain-inhibitor-packet.mjs";

const read = (hex) => readCurrentInhibitorPacketState(Buffer.from(hex, "hex"));

test("reads original inhibitor snapshot and gameplay state independent of timer width", () => {
  for (const payload of ["91", "93dec4", "979d", "926ec4", "966ec4", "986ec4"])
    assert.equal(read(payload), "alive");
  for (const payload of ["81", "80", "8a6ec4", "871ac4"])
    assert.equal(read(payload), "destroyed");
});

test("rejects truncated, excess, and inconsistent timer bytes", () => {
  for (const payload of ["", "8100", "92", "926e", "926ec400", "926ec40000"])
    assert.throws(() => read(payload), /inhibitor state/);
});
