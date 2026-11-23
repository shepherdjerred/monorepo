import { sameCheckpointData } from "./checkpoint-data-equality.mjs";

// Test-only read boundary. Keep insertion-order collections as iterators and
// release each row's graph-comparison memo before reading the next row. A single
// all-match pair memo retains millions of otherwise dead wrapper objects.
// The header is produced by the original #checkpointData([], []) method; its
// ledger and generation fields are compared in full below, not omitted.
export function compareCheckpointStateParts(left, right) {
  if (!sameCheckpointData(left.header, right.header))
    throw Error("Checkpoint header/active state differs");
  const counts = {};
  for (const field of ["ledger", "generations"]) {
    const a = left[field],
      b = right[field];
    if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size)
      throw Error(`Checkpoint ${field} collection differs`);
    const ai = a.entries(),
      bi = b.entries();
    let compared = 0;
    for (;;) {
      const av = ai.next(),
        bv = bi.next();
      if (av.done || bv.done) {
        if (av.done !== bv.done || compared !== a.size)
          throw Error(`Checkpoint ${field} iteration differs`);
        break;
      }
      if (!sameCheckpointData(av.value, bv.value))
        throw Error(`Checkpoint ${field} row differs at ${compared}`);
      compared++;
    }
    counts[field] = compared;
  }
  return counts;
}
