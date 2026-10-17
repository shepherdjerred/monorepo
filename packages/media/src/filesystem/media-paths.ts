import path from "node:path";
import {
  FileOperationConflict,
  type MediaFileRoots,
} from "./operations-types.ts";

type Kind = "movies" | "tv";
type Root = "library" | "control" | "downloads";
type Roots = Record<Kind, MediaFileRoots>;
type MappingEntry = {
  kind: Kind;
  root: Root;
  canonical: string;
  worker: string;
};
export type MediaPathMapping = {
  canonical: (kind: Kind, root: Root, relative: string) => string;
  local: (canonicalAbsolute: string) => string;
};

const within = (root: string, filename: string) =>
  filename === root || filename.startsWith(`${root}${path.sep}`);
const fail = (): never => {
  throw new FileOperationConflict(
    "Media path mapping is ambiguous or outside its declared roots",
  );
};
function absolute(value: string) {
  if (
    !path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    value === path.parse(value).root
  )
    fail();
}
function relative(value: string) {
  if (value === "") return;
  if (
    value === "." ||
    path.isAbsolute(value) ||
    path.normalize(value) !== value ||
    value.split(path.sep).includes("..")
  )
    fail();
}

function assertMappingPair(left: MappingEntry, right: MappingEntry) {
  if (left === right) return;
  const sameDownloads = left.root === "downloads" && right.root === "downloads";
  if (left.canonical === right.canonical || left.worker === right.worker) {
    if (
      !sameDownloads ||
      left.canonical !== right.canonical ||
      left.worker !== right.worker
    )
      fail();
    return;
  }
  const overlaps =
    within(left.canonical, right.canonical) ||
    within(right.canonical, left.canonical) ||
    within(left.worker, right.worker) ||
    within(right.worker, left.worker);
  const nestedControl =
    left.kind === right.kind &&
    new Set([left.root, right.root]).size === 2 &&
    [left.root, right.root].includes("library") &&
    [left.root, right.root].includes("control");
  if (overlaps && !nestedControl) fail();
  // The more-specific control root projects the same relative name in both namespaces.
  if (
    within(left.canonical, right.canonical) !==
    within(left.worker, right.worker)
  )
    fail();
  if (
    within(left.canonical, right.canonical) &&
    path.relative(left.canonical, right.canonical) !==
      path.relative(left.worker, right.worker)
  )
    fail();
}

/** Trusted constructor-only namespace; never accepted from commands, history or stored proof. */
export function createMediaPathMapping(input: {
  canonicalRoots: Roots;
  workerRoots: Roots;
}): MediaPathMapping {
  const entries = (["movies", "tv"] as const).flatMap((kind) =>
    (["library", "control", "downloads"] as const).map((root) => ({
      kind,
      root,
      canonical: input.canonicalRoots[kind][root],
      worker: input.workerRoots[kind][root],
    })),
  );
  for (const entry of entries) {
    absolute(entry.canonical);
    absolute(entry.worker);
  }
  for (const left of entries)
    for (const right of entries) assertMappingPair(left, right);
  const select = (filename: string, field: "canonical" | "worker") => {
    absolute(filename);
    const matches = entries
      .filter((entry) => within(entry[field], filename))
      .sort((a, b) => b[field].length - a[field].length);
    const first = matches[0];
    return first ?? fail();
  };
  return {
    canonical: (kind, root, value) => {
      relative(value);
      const entry = entries.find(
        (item) => item.kind === kind && item.root === root,
      );
      if (entry === undefined) return fail();
      const filename = path.join(entry.canonical, value);
      const actual = select(filename, "canonical");
      if (
        actual.root !== root ||
        (root !== "downloads" && actual.kind !== kind)
      )
        fail();
      return filename;
    },
    local: (filename) => {
      const entry = select(filename, "canonical");
      const result = path.join(
        entry.worker,
        path.relative(entry.canonical, filename),
      );
      const reverse = select(result, "worker");
      if (
        reverse.canonical !== entry.canonical ||
        reverse.worker !== entry.worker
      )
        fail();
      return result;
    },
  };
}
