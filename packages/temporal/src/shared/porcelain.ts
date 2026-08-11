// Parser for `git status --porcelain` (v1) output, shared by every bot-clone
// activity that stages a path-scoped subset of a regenerated tree.
//
// This lived in two places with two implementations. Only one of them was ever
// paired with callers that pass `trimStdout: false`; the other silently mangled
// the first path on every run (PRs #1709 and #1971 shipped
// `ackages/scout-for-lol/...` in their bodies and disabled the showcase job's
// timestamp-only suppression entirely). Keep exactly one copy here.
//
// Format: each line is `XY<space>PATH` — a two-character status field plus one
// separator space, so the path always starts at index 3.
//
// The load-bearing subtlety: an unstaged-only change is ` M path` with a
// LEADING SPACE (index status ' ' = unmodified, work-tree status 'M' =
// modified). A whole-string `.trim()` of the command output — which is what
// `runCommand` does by default — eats that space off the FIRST line only,
// shifting `slice(3)` one character into the path. Callers must therefore read
// the status with `trimStdout: false`; this parser drops empty lines itself.
export function parsePorcelainPaths(status: string): string[] {
  return status
    .split("\n")
    .filter((line) => line.length > 3)
    .map((line) => line.slice(3).trim());
}
