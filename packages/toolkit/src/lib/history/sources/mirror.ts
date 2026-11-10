import { sha256Hex } from "#lib/brim/sync/crypto.ts";
import {
  readMirrorIndex,
  type MirrorMachine,
} from "#lib/brim/sync/mirror-index.ts";
import type { HistoryPaths } from "#lib/history/paths.ts";
import { failedScanResult } from "#lib/history/sources-shared.ts";
import type {
  HistoryDocument,
  HistoryMessage,
  HistoryRecord,
  HistoryScanOptions,
  HistorySource,
  HistorySourceName,
  HistorySourceReadResult,
  HistorySourceResult,
} from "#lib/history/types.ts";

/**
 * Indexes other machines' transcripts that `brim sync pull` mirrored into
 * `~/.toolkit/brim-sync/mirror/`. Each mirrored root is scanned by its own
 * instance of the ordinary Claude or Codex source (so parsing, incremental
 * caches and usage pricing are identical), and the results are re-labelled:
 * the source becomes `claude-mirror` / `codex-mirror`, every source id gains
 * a `<machine>/` prefix, and the agent names the machine.
 *
 * Mirror sources never feed the usage-export ledger: those tokens were
 * already counted on the machine that spent them.
 */

type MirrorRoot = {
  /** Source-id prefix, `<machine>` or `<machine>/<n>` for extra roots. */
  readonly key: string;
  readonly machine: MirrorMachine;
  readonly paths: HistoryPaths;
};

export type MirrorSourceSpec = {
  readonly name: HistorySourceName;
  readonly label: string;
  readonly createBase: () => HistorySource;
  readonly roots: (
    machine: MirrorMachine,
    base: HistoryPaths,
  ) => HistoryPaths[];
};

function rootsFor(
  spec: MirrorSourceSpec,
  machines: readonly MirrorMachine[],
  base: HistoryPaths,
): MirrorRoot[] {
  return machines.flatMap((machine) => {
    const roots = spec.roots(machine, base);
    return roots.map((paths, index) => ({
      key:
        roots.length === 1
          ? machine.machineId
          : `${machine.machineId}/${String(index)}`,
      machine,
      paths,
    }));
  });
}

function relabel(
  spec: MirrorSourceSpec,
  root: MirrorRoot,
  document: HistoryDocument,
): HistoryDocument {
  return {
    ...document,
    source: spec.name,
    sourceId: `${root.key}/${document.sourceId}`,
    machine: root.machine.machineId,
    agent: `${document.agent ?? spec.label} · ${root.machine.displayName}`,
  };
}

function unavailable(name: HistorySourceName): HistorySourceResult {
  return {
    source: name,
    available: false,
    documents: [],
    fingerprint: "missing",
    error: null,
    complete: true,
    sourceIds: [],
  };
}

export function createMirrorSource(spec: MirrorSourceSpec): HistorySource {
  const bases = new Map<string, HistorySource>();
  const baseFor = (key: string): HistorySource => {
    let base = bases.get(key);
    if (base === undefined) {
      base = spec.createBase();
      bases.set(key, base);
    }
    return base;
  };
  async function scan(
    paths: HistoryPaths,
    options?: HistoryScanOptions,
  ): Promise<HistorySourceResult> {
    let index;
    try {
      index = await readMirrorIndex(paths.brimSyncMirrorIndex);
    } catch (error: unknown) {
      return failedScanResult(spec.name, "invalid-index", error);
    }
    if (index === null) return unavailable(spec.name);
    const roots = rootsFor(spec, index.machines, paths);
    const documents: HistoryDocument[] = [];
    const sourceIds: string[] = [];
    const fingerprints: string[] = [];
    let complete = true;
    for (const root of roots) {
      const result = await baseFor(root.key).scan(root.paths, options);
      if (result.error !== null) {
        return failedScanResult(
          spec.name,
          sha256Hex(fingerprints.join("\n")),
          new Error(`${root.key}: ${result.error}`),
        );
      }
      if (!result.available) continue;
      complete &&= result.complete;
      fingerprints.push(`${root.key}:${result.fingerprint}`);
      for (const document of result.documents) {
        documents.push(relabel(spec, root, document));
      }
      for (const id of result.sourceIds) sourceIds.push(`${root.key}/${id}`);
    }
    if (fingerprints.length === 0) return unavailable(spec.name);
    return {
      source: spec.name,
      available: true,
      documents,
      fingerprint: sha256Hex(fingerprints.join("\n")),
      error: null,
      complete,
      sourceIds: complete ? sourceIds : sourceIds.toSorted(),
    };
  }

  async function read(
    paths: HistoryPaths,
    records: readonly HistoryRecord[],
  ): Promise<HistorySourceReadResult> {
    const messages = new Map<string, readonly HistoryMessage[]>();
    const missingSourceIds: string[] = [];
    const errors: string[] = [];
    const index = await readMirrorIndex(paths.brimSyncMirrorIndex);
    const roots = index === null ? [] : rootsFor(spec, index.machines, paths);
    for (const root of roots) {
      const prefix = `${root.key}/`;
      const owned = records
        .filter((record) => record.sourceId.startsWith(prefix))
        .map((record) => ({
          ...record,
          sourceId: record.sourceId.slice(prefix.length),
        }));
      if (owned.length === 0) continue;
      const result = await baseFor(root.key).read(root.paths, owned);
      for (const [id, value] of result.messages) {
        messages.set(`${prefix}${id}`, value);
      }
      for (const id of result.missingSourceIds) {
        missingSourceIds.push(`${prefix}${id}`);
      }
      if (result.error !== null) errors.push(`${root.key}: ${result.error}`);
    }
    for (const record of records) {
      if (
        !messages.has(record.sourceId) &&
        !missingSourceIds.includes(record.sourceId)
      ) {
        missingSourceIds.push(record.sourceId);
      }
    }
    return {
      source: spec.name,
      messages,
      missingSourceIds,
      error: errors.length === 0 ? null : errors.join("; "),
    };
  }

  return {
    name: spec.name,
    label: spec.label,
    scan,
    commitScan: () => {
      for (const base of bases.values()) base.commitScan?.();
    },
    read,
  };
}

/** HistoryPaths for one mirrored Claude projects root. */
export function claudeMirrorPaths(
  machine: MirrorMachine,
  base: HistoryPaths,
): HistoryPaths[] {
  return machine.claudeProjectsDirs.map((claudeProjects) => ({
    ...base,
    claudeProjects,
  }));
}

/** HistoryPaths for each mirrored Codex sessions or archived-sessions root. */
export function codexMirrorPaths(
  machine: MirrorMachine,
  base: HistoryPaths,
): HistoryPaths[] {
  return [
    ...machine.codexSessionsDirs,
    ...machine.codexArchivedSessionsDirs,
  ].map((codexSessionsDir) => ({ ...base, codexSessionsDir }));
}
