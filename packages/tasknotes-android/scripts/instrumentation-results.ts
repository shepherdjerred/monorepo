import assert from "node:assert/strict";

/** AndroidJUnitRunner start/success records are required for every expected method. */
export function assertInstrumentationSuccess(
  transcript: string,
  expected: readonly string[],
) {
  assert.ok(expected.length > 0 && new Set(expected).size === expected.length);
  const started = new Set<string>();
  const passed = new Set<string>();
  const status = new Map<string, string>();
  let finishes = 0;
  for (const line of transcript.split(/\r?\n/)) {
    const field = /^INSTRUMENTATION_STATUS: ([^=]+)=(.*)$/.exec(line);
    if (field?.[1] !== undefined && field[2] !== undefined)
      status.set(field[1], field[2]);
    const code = /^INSTRUMENTATION_STATUS_CODE: (-?\d+)$/.exec(line);
    if (code !== null) {
      const identity = `${status.get("class")}#${status.get("test")}`;
      assert.ok(
        expected.includes(identity),
        `Unexpected instrumentation test: ${identity}`,
      );
      if (code[1] === "1") {
        assert.ok(
          !started.has(identity),
          `Duplicate instrumentation start: ${identity}`,
        );
        started.add(identity);
      } else {
        assert.equal(
          code[1],
          "0",
          `Instrumentation failed, skipped or assumed: ${identity}`,
        );
        assert.ok(
          started.has(identity) && !passed.has(identity),
          `Unmatched instrumentation success: ${identity}`,
        );
        passed.add(identity);
      }
      status.clear();
    }
    const finish = /^INSTRUMENTATION_CODE: (-?\d+)$/.exec(line);
    if (finish !== null) {
      assert.equal(finish[1], "-1");
      finishes++;
    }
  }
  assert.equal(finishes, 1, "Instrumentation must finish exactly once.");
  assert.deepEqual(
    [...passed].sort(),
    [...expected].sort(),
    "Every expected test must report success.",
  );
  assert.ok(
    transcript.includes(
      `OK (${expected.length} ${expected.length === 1 ? "test" : "tests"})`,
    ),
  );
  assert.ok(
    !/FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed/.test(transcript),
  );
}
