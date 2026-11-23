import { expect, test } from "bun:test";
import { originalCheckpointCacheSource } from "./checkpoint-cache-control-source.mjs";

test("executable baseline preserves the current simulation version and has strict source seams", async () => {
  const source = (
    await Bun.file(
      new URL("../latest-direct-effect-runtime.mjs", import.meta.url),
    ).text()
  ).replaceAll("\r\n", "\n");
  const baseline = originalCheckpointCacheSource(source);
  expect(baseline.match(/DIRECT_EFFECT_PROGRAM_VERSION = \d+/)[0]).toBe(
    source.match(/DIRECT_EFFECT_PROGRAM_VERSION = \d+/)[0],
  );
  expect(baseline).toContain("this.#checkpoints.findLast");
  expect(baseline).toContain("this.#checkpoints.shift()");
  expect(baseline).not.toContain("#restoreCheckpoint");
  expect(baseline).not.toContain("retainDirectCheckpoint");
  expect(() => originalCheckpointCacheSource(baseline)).toThrow(
    "Exact original",
  );
  expect(() =>
    originalCheckpointCacheSource(
      source.replace(
        "const saved = directCheckpointAtOrBefore",
        "const changed = directCheckpointAtOrBefore",
      ),
    ),
  ).toThrow("Exact original");
});
