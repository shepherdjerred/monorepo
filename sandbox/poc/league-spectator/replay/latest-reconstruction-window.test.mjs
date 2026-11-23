import { expect, test } from "bun:test";
import { createLatestReconstructionWindow } from "./latest-reconstruction-window.mjs";

test("whole-container policy retains observed original final SR packets and separate declared precision", () => {
  const window = createLatestReconstructionWindow({
    declaredMilliseconds: 1553143,
    requestedEndTimeSeconds: 1553.143,
  });
  const rows = [
      { stream: 2, opcode: 728, time: 0 },
      { stream: 1, opcode: 26, time: 1553.0762939453125 },
      { stream: 1, opcode: 734, time: 1553.143310546875 },
      { stream: 1, opcode: 397, time: 1553.143310546875 },
    ],
    original = structuredClone(rows);
  for (const row of rows) window.observe(row);
  const result = window.finish();
  expect(result.effectiveEndTimeSeconds).toBe(1553.143310546875);
  expect(result.declaredDurationSeconds).toBe(1553.143);
  expect(result.coveredGameplayPackets).toBe(4);
  expect(result.withinRequestedPackets).toBe(2);
  expect(result.beyondDeclaredPackets).toBe(2);
  expect(result.tailOpcodes).toEqual({ 734: 1, 397: 1 });
  expect(result.nativeFooterRoundingRuleRecovered).toBe(false);
  expect(rows).toEqual(original);
  expect(() => window.observe(rows[0])).toThrow("finalized");
});
test("partial seek windows remain strict while complete source transport coverage is reported", () => {
  const window = createLatestReconstructionWindow({
    declaredMilliseconds: 200000,
    requestedEndTimeSeconds: 120,
  });
  for (const time of [0, 120, 120.000001, 200.0001])
    window.observe({ stream: 1, opcode: 26, time });
  const result = window.finish();
  expect(result.scope).toBe("partial");
  expect(result.effectiveEndTimeSeconds).toBe(120);
  expect(result.packets).toBe(4);
  expect(result.coveredGameplayPackets).toBe(2);
});
test("whole-container playback rejects a genuinely later tail instead of applying an epsilon or clamping time", () => {
  const window = createLatestReconstructionWindow({
    declaredMilliseconds: 10000,
    requestedEndTimeSeconds: 10,
  });
  window.observe({ stream: 1, opcode: 26, time: 10.0006 });
  expect(() => window.finish()).toThrow(
    "beyond the declared container millisecond",
  );
  expect(() =>
    createLatestReconstructionWindow({
      declaredMilliseconds: 10000.5,
      requestedEndTimeSeconds: 10.0005,
    }),
  ).toThrow("original integer-millisecond");
});
