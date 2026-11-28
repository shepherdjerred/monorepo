import {
  SNAPSHOT_V2_BUDGET,
  type SnapshotV2FileClass,
} from "@scout-for-lol/data/meta/snapshot-v2-budget.ts";
import {
  championFile,
  matchupFile,
  SNAPSHOT_V2_INDEX_PATH,
  SnapshotChampionSchema,
  SnapshotIndexSchema,
  SnapshotMatchupSchema,
  type SnapshotChampion,
  type SnapshotIndex,
  type SnapshotMatchup,
  type SnapshotV2,
} from "./snapshot-v2-schema.ts";

/**
 * The snapshot v2 as files: a path-to-text map the refresh writes into the
 * committed directory and a reader parses back, validating every cross
 * reference. Compact JSON, one file per page's data, in a fixed order so a
 * re-run over unchanged API data is byte-identical.
 */

export type SnapshotTexts = ReadonlyMap<string, string>;

function text(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function serializeSnapshotV2(snapshot: SnapshotV2): Map<string, string> {
  const files = new Map<string, string>();
  files.set(SNAPSHOT_V2_INDEX_PATH, text(snapshot.index));
  for (const [path, champion] of snapshot.champions) {
    files.set(path, text(champion));
  }
  for (const [path, matchup] of snapshot.matchups) {
    files.set(path, text(matchup));
  }
  return files;
}

function fileText(files: SnapshotTexts, path: string): string {
  const found = files.get(path);
  if (found === undefined) throw new Error(`Snapshot is missing ${path}`);
  return found;
}

function parseJson(path: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`Snapshot file ${path} is not JSON`, { cause: error });
  }
}

export function parseChampion(
  files: SnapshotTexts,
  index: SnapshotIndex,
  listed: SnapshotIndex["champions"][number],
): { path: string; champion: SnapshotChampion } {
  const path = championFile(listed.slug);
  const champion = SnapshotChampionSchema.parse(
    parseJson(path, fileText(files, path)),
  );
  if (
    champion.id !== listed.id ||
    champion.name !== listed.name ||
    champion.slug !== listed.slug
  ) {
    throw new Error(`${path} is not the champion the index lists`);
  }
  if (champion.buildId !== index.source?.buildId) {
    throw new Error(`${path} is from build ${champion.buildId}`);
  }
  for (const group of champion.matchups) {
    const role = listed.roles.find((entry) => entry.role === group.role);
    if (role?.opponents !== group.opponents.length) {
      throw new Error(
        `${path} lists ${group.opponents.length.toString()} ${group.role} opponents, the index ${String(role?.opponents)}`,
      );
    }
  }
  return { path, champion };
}

export function parseMatchup(
  files: SnapshotTexts,
  champion: SnapshotChampion,
  role: SnapshotMatchup["context"]["role"],
  opponent: SnapshotChampion["matchups"][number]["opponents"][number],
): { path: string; matchup: SnapshotMatchup } {
  const path = matchupFile(champion.slug, role, opponent.slug);
  const matchup = SnapshotMatchupSchema.parse(
    parseJson(path, fileText(files, path)),
  );
  if (
    matchup.buildId !== champion.buildId ||
    matchup.champion.id !== champion.id ||
    matchup.opponent.id !== opponent.id ||
    matchup.context.role !== role
  ) {
    throw new Error(`${path} is not the matchup ${champion.slug} lists`);
  }
  return { path, matchup };
}

/**
 * Parse every file and check the references between them: the index names
 * exactly the champion files present, each champion's listed opponents are
 * exactly its matchup files, and every file is from the index's build and
 * context. A file the index does not reach is an error, so a removed matchup
 * cannot linger.
 */
export function parseSnapshotV2(files: SnapshotTexts): SnapshotV2 {
  const index = SnapshotIndexSchema.parse(
    parseJson(SNAPSHOT_V2_INDEX_PATH, fileText(files, SNAPSHOT_V2_INDEX_PATH)),
  );
  const snapshot: SnapshotV2 = {
    index,
    champions: new Map(),
    matchups: new Map(),
  };
  for (const listed of index.champions) {
    const { path, champion } = parseChampion(files, index, listed);
    snapshot.champions.set(path, champion);
    for (const group of champion.matchups) {
      for (const opponent of group.opponents) {
        const parsed = parseMatchup(files, champion, group.role, opponent);
        snapshot.matchups.set(parsed.path, parsed.matchup);
      }
    }
  }
  const reached = new Set([
    SNAPSHOT_V2_INDEX_PATH,
    ...snapshot.champions.keys(),
    ...snapshot.matchups.keys(),
  ]);
  const extra = [...files.keys()].filter((path) => !reached.has(path));
  if (extra.length > 0) {
    throw new Error(
      `Snapshot has files the index does not reach: ${extra.toSorted().join(", ")}`,
    );
  }
  return snapshot;
}

export function classOf(path: string): SnapshotV2FileClass {
  if (path === SNAPSHOT_V2_INDEX_PATH) return "index";
  if (path.startsWith("champions/")) return "champion";
  if (path.startsWith("matchups/")) return "matchup";
  throw new Error(`Not a snapshot v2 file: ${path}`);
}

/** Every budget the files break, per file and per class total; empty when within. */
export function snapshotBudgetViolations(files: SnapshotTexts): string[] {
  const totals = new Map<SnapshotV2FileClass, number>();
  const violations: string[] = [];
  for (const [path, content] of files) {
    const kind = classOf(path);
    const size = new TextEncoder().encode(content).length;
    totals.set(kind, (totals.get(kind) ?? 0) + size);
    const { maxBytes } = SNAPSHOT_V2_BUDGET[kind];
    if (size > maxBytes) {
      violations.push(
        `${path}: ${size.toString()} bytes exceeds ${maxBytes.toString()}`,
      );
    }
  }
  for (const kind of ["champion", "matchup"] as const) {
    const total = totals.get(kind) ?? 0;
    const { totalMaxBytes } = SNAPSHOT_V2_BUDGET[kind];
    if (total > totalMaxBytes) {
      violations.push(
        `${kind} files: ${total.toString()} bytes in total exceeds ${totalMaxBytes.toString()}`,
      );
    }
  }
  return violations;
}

/** Refuse to write a snapshot over budget; a broken budget is a decision, not a retry. */
export function assertSnapshotWithinBudget(files: SnapshotTexts): void {
  const violations = snapshotBudgetViolations(files);
  if (violations.length > 0) {
    throw new Error(
      `Champion meta snapshot is over its size budget:\n${violations.join("\n")}`,
    );
  }
}
