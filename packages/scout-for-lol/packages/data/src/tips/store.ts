import { mkdir, rename } from "node:fs/promises";
import type { ChampionId } from "#src/model/core/identifiers.ts";
import { getChampionById } from "#src/model/riot/champion-registry.ts";
import type { Lane } from "#src/model/riot/lane.ts";
import {
  GLOSSARY_FILE_PATH,
  type GeneralTipFile,
  GeneralTipFileSchema,
  type GeneralTipSet,
  type GlossaryEntry,
  type GlossaryFile,
  GlossaryFileSchema,
  type GlossaryId,
  type MatchupTipFile,
  MatchupTipFileSchema,
  type MatchupTipSet,
  TIP_FILE_SCHEMA_VERSION,
  generalTipFilePath,
  matchupTipFilePath,
} from "#src/tips/schema.ts";

/**
 * Read and write the generated tips on disk, in the layout `schema.ts`
 * defines. Files are loaded on first use, changed in memory, and written back
 * (sorted, schema-checked) only for the files that changed.
 */

export type TipStore = {
  matchupSet: (
    lane: Lane,
    championId: ChampionId,
    opponentId: ChampionId,
  ) => Promise<MatchupTipSet | undefined>;
  generalSet: (
    lane: Lane,
    championId: ChampionId,
  ) => Promise<GeneralTipSet | undefined>;
  glossary: () => Promise<ReadonlyMap<GlossaryId, GlossaryEntry>>;
  putMatchupSet: (set: MatchupTipSet) => Promise<void>;
  putGeneralSet: (set: GeneralTipSet) => Promise<void>;
  /** Add entries whose ids are not in the glossary yet; existing ids win. */
  addGlossaryEntries: (entries: readonly GlossaryEntry[]) => Promise<void>;
  /** Write every changed file. */
  flush: () => Promise<void>;
};

/** Format a JSON value for a file; the script passes Prettier's formatting. */
export type FormatJson = (path: string, value: unknown) => Promise<string>;

export const plainJson: FormatJson = (_path, value) =>
  Promise.resolve(`${JSON.stringify(value, null, 2)}\n`);

function championKey(championId: ChampionId): string {
  const entry = getChampionById(championId);
  if (entry === undefined) {
    throw new Error(
      `champion ${championId.toString()} is not in the Data Dragon registry`,
    );
  }
  return entry.key;
}

async function readJsonFile(path: string): Promise<unknown> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return undefined;
  }
  const value: unknown = await file.json();
  return value;
}

async function writeAtomically(path: string, text: string): Promise<void> {
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await Bun.write(temporary, text);
  await rename(temporary, path);
}

export function createTipStore(options: {
  directory: string;
  format?: FormatJson;
}): TipStore {
  const { directory } = options;
  const format = options.format ?? plainJson;
  const matchupFiles = new Map<string, MatchupTipFile>();
  const generalFiles = new Map<Lane, GeneralTipFile>();
  let glossaryFile: GlossaryFile | undefined;
  /** Changed files: relative path to a schema-checked snapshot of its contents. */
  const dirty = new Map<string, () => unknown>();

  async function matchupFile(
    lane: Lane,
    championId: ChampionId,
  ): Promise<MatchupTipFile> {
    const path = matchupTipFilePath(lane, championKey(championId));
    const cached = matchupFiles.get(path);
    if (cached !== undefined) {
      return cached;
    }
    const raw = await readJsonFile(`${directory}/${path}`);
    const file = MatchupTipFileSchema.parse(
      raw ?? {
        schemaVersion: TIP_FILE_SCHEMA_VERSION,
        lane,
        champion: championId,
        sets: [],
      },
    );
    matchupFiles.set(path, file);
    return file;
  }

  async function generalFile(lane: Lane): Promise<GeneralTipFile> {
    const cached = generalFiles.get(lane);
    if (cached !== undefined) {
      return cached;
    }
    const raw = await readJsonFile(`${directory}/${generalTipFilePath(lane)}`);
    const file = GeneralTipFileSchema.parse(
      raw ?? { schemaVersion: TIP_FILE_SCHEMA_VERSION, lane, sets: [] },
    );
    generalFiles.set(lane, file);
    return file;
  }

  async function glossaryState(): Promise<GlossaryFile> {
    if (glossaryFile !== undefined) {
      return glossaryFile;
    }
    const raw = await readJsonFile(`${directory}/${GLOSSARY_FILE_PATH}`);
    glossaryFile = GlossaryFileSchema.parse(
      raw ?? { schemaVersion: TIP_FILE_SCHEMA_VERSION, entries: [] },
    );
    return glossaryFile;
  }

  let flushing: Promise<void> | undefined;

  async function writeDirty(): Promise<void> {
    for (const [path, snapshot] of [...dirty].toSorted(([left], [right]) =>
      left < right ? -1 : 1,
    )) {
      await writeAtomically(
        `${directory}/${path}`,
        await format(path, snapshot()),
      );
      dirty.delete(path);
    }
  }

  return {
    matchupSet: async (lane, championId, opponentId) => {
      const file = await matchupFile(lane, championId);
      return file.sets.find((set) => set.opponent === opponentId);
    },
    generalSet: async (lane, championId) => {
      const file = await generalFile(lane);
      return file.sets.find((set) => set.champion === championId);
    },
    glossary: async () => {
      const file = await glossaryState();
      return new Map(file.entries.map((entry) => [entry.id, entry]));
    },
    putMatchupSet: async (set) => {
      const file = await matchupFile(set.lane, set.champion);
      file.sets = [
        ...file.sets.filter((existing) => existing.opponent !== set.opponent),
        set,
      ].toSorted((left, right) => left.opponent - right.opponent);
      dirty.set(matchupTipFilePath(set.lane, championKey(set.champion)), () =>
        MatchupTipFileSchema.parse(file),
      );
    },
    putGeneralSet: async (set) => {
      const file = await generalFile(set.lane);
      file.sets = [
        ...file.sets.filter((existing) => existing.champion !== set.champion),
        set,
      ].toSorted((left, right) => left.champion - right.champion);
      dirty.set(generalTipFilePath(set.lane), () =>
        GeneralTipFileSchema.parse(file),
      );
    },
    addGlossaryEntries: async (entries) => {
      const file = await glossaryState();
      const known = new Set(file.entries.map((entry) => entry.id));
      const added = entries.filter((entry) => !known.has(entry.id));
      if (added.length === 0) {
        return;
      }
      file.entries = [...file.entries, ...added].toSorted((left, right) =>
        left.id < right.id ? -1 : 1,
      );
      dirty.set(GLOSSARY_FILE_PATH, () => GlossaryFileSchema.parse(file));
    },
    flush: async () => {
      // One writer at a time, so two flushes never race on the same file.
      while (flushing !== undefined) {
        await flushing;
      }
      flushing = writeDirty();
      try {
        await flushing;
      } finally {
        flushing = undefined;
      }
    },
  };
}
