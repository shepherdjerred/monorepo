// Test-only executable baseline. Revert exactly the cache lookup/retention and
// restore ownership changes, preserving the current complete simulation program.
// In particular never relabel an older program version as a newer definition.
export function originalCheckpointCacheSource(source) {
  const replace = (before, after) => {
    if (source.split(before).length !== 2)
      throw Error("Exact original checkpoint cache control seam required");
    source = source.replace(before, after);
  };
  replace(
    'import {\n  directCheckpointAtOrBefore,\n  retainDirectCheckpoint,\n} from "./latest-direct-checkpoint-cache.mjs";\n',
    "",
  );
  replace(
    "    const saved = directCheckpointAtOrBefore(this.#checkpoints, time);\n    if (time < this.time || (saved && saved.time > this.time))\n      this.#restoreCheckpoint(saved ?? this.#initial);",
    "    if (time < this.time) {\n      const saved =\n        this.#checkpoints.findLast((s) => s.time <= time) ?? this.#initial;\n      this.restore(saved);\n    }",
  );
  replace(
    "        this.#checkpoints = retainDirectCheckpoint(\n          this.#checkpoints,\n          this.#automaticCheckpoint(),\n          this.maximumCheckpoints,\n        );",
    "        this.#checkpoints.push(this.#automaticCheckpoint());\n        if (this.#checkpoints.length > this.maximumCheckpoints)\n          this.#checkpoints.shift();",
  );
  replace(
    "    const saved = {\n      schema: 1,\n      contract: this.contract,\n      time: this.time,\n      tick: this.tick,\n      cursor: this.cursor,\n    };",
    "    const saved = { schema: 1, contract: this.contract, time: this.time };",
  );
  replace(
    "  restore(saved) {\n    this.#restoreCheckpoint(saved);\n    // A detached caller-supplied state can represent a different branch even\n    // under the same replay contract. Only internal cached restores retain\n    // alternative states for subsequent forward/backward seeks.\n    this.#checkpoints = [];\n  }\n\n  #restoreCheckpoint(saved) {",
    "  restore(saved) {",
  );
  return source;
}
