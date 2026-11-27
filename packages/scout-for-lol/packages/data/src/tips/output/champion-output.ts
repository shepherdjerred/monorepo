import { LANE_ORDER, type Lane } from "#src/model/riot/lane.ts";
import {
  CHAMPION_TIPS_SCHEMA_VERSION,
  type ChampionTipsFile,
  ChampionTipsFileSchema,
  type ChampionTipsIndex,
  type OutputCombo,
  type OutputComboStep,
  type OutputGeneralSet,
  type OutputMatchupSet,
  type OutputTip,
  type TextRef,
  championTipsPath,
} from "#src/tips/output/champion-tips.ts";
import type { Combo } from "#src/tips/combos/combo-schema.ts";
import {
  type FactIndex,
  type RefContext,
  abilityFactKey,
  refsFor,
  validateKey,
  validateRefs,
} from "#src/tips/output/refs.ts";
import type { Cite } from "#src/tips/schema.ts";

/**
 * Assemble the per-champion files from what a pipeline run kept: the tips with
 * their Decisions score, the combos, and the cites the validators checked. A
 * unit whose references do not all resolve fails whole and is left out.
 */

export type StoredTip = {
  id: string;
  text: string;
  cites: Cite[];
  pWrong: number;
  hidden: boolean;
};

export type StoredCombo = {
  combo: Combo;
  /** Ability cites of the combo's steps, so its text can be linked. */
  cites: Cite[];
};

export type StoredSet = {
  subjectKey: string;
  /** Data Dragon key of the opponent; absent for a general set. */
  opponentKey?: string | undefined;
  tips: StoredTip[];
  combos: StoredCombo[];
};

export type StoredUnit = {
  id: string;
  lane: Lane;
  inputHash: string;
  sets: StoredSet[];
};

export type OutputMeta = {
  patch: string;
  model: string;
  promptVersion: string;
};

export type FailedUnit = { unitId: string; issues: string[] };

const laneRank = (lane: Lane): number => LANE_ORDER.indexOf(lane);

/** Code-unit order, the same on every machine (a locale compare orders "Kaisa" before "KSante", a plain sort does not). */
const byCode = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const round2 = (value: number): number => Math.round(value * 100) / 100;

function stepOf(
  step: Combo["sequence"][number],
  championKey: string,
): OutputComboStep {
  if (step === "attack") {
    return "attack";
  }
  if (step.kind === "ability") {
    return { kind: "ability", key: abilityFactKey(championKey, step.slot) };
  }
  return {
    kind: step.kind === "spell" ? "summoner-spell" : "item",
    key: step.id.toString(),
  };
}

function convertTip(
  tip: StoredTip,
  context: RefContext,
  issues: string[],
): OutputTip {
  const refs: TextRef[] = refsFor(tip.text, tip.cites, context);
  for (const issue of validateRefs(tip.text, refs, context.index)) {
    issues.push(`${tip.id}: ${issue.message}`);
  }
  return {
    id: tip.id,
    text: tip.text,
    refs,
    pWrong: round2(tip.pWrong),
    ...(tip.hidden ? { hidden: true as const } : {}),
  };
}

function convertCombo(
  entry: StoredCombo,
  championKey: string,
  context: RefContext,
  issues: string[],
): OutputCombo {
  const { combo } = entry;
  const whenRefs = refsFor(combo.when, entry.cites, context);
  const textRefs = refsFor(combo.text, entry.cites, context);
  for (const issue of [
    ...validateRefs(combo.when, whenRefs, context.index),
    ...validateRefs(combo.text, textRefs, context.index),
  ]) {
    issues.push(`${combo.id}: ${issue.message}`);
  }
  const sequence = combo.sequence.map((step) => stepOf(step, championKey));
  for (const step of sequence) {
    if (step !== "attack") {
      for (const issue of validateKey(step.kind, step.key, context.index)) {
        issues.push(`${combo.id}: ${issue.message}`);
      }
    }
  }
  return {
    id: combo.id,
    name: combo.name,
    category: combo.category,
    sequence,
    when: combo.when,
    whenRefs,
    text: combo.text,
    textRefs,
  };
}

/** Group the units by champion into schema-valid files; units with an unresolvable reference are returned as failed. */
export function buildChampionFiles(
  units: readonly StoredUnit[],
  meta: OutputMeta,
  context: RefContext,
): { files: Map<string, ChampionTipsFile>; failed: FailedUnit[] } {
  const generals = new Map<string, OutputGeneralSet[]>();
  const matchups = new Map<string, OutputMatchupSet[]>();
  const failed: FailedUnit[] = [];
  for (const unit of units) {
    const issues: string[] = [];
    const converted = unit.sets.map((set) => {
      const tips = set.tips.map((tip) => convertTip(tip, context, issues));
      return set.opponentKey === undefined
        ? {
            champion: set.subjectKey,
            general: {
              lane: unit.lane,
              inputHash: unit.inputHash,
              tips,
              combos: set.combos.map((combo) =>
                convertCombo(combo, set.subjectKey, context, issues),
              ),
            } satisfies OutputGeneralSet,
          }
        : {
            champion: set.subjectKey,
            matchup: {
              lane: unit.lane,
              inputHash: unit.inputHash,
              opponent: set.opponentKey,
              tips,
              comboRefs: [],
            } satisfies OutputMatchupSet,
          };
    });
    if (issues.length > 0) {
      failed.push({ unitId: unit.id, issues });
      continue;
    }
    for (const entry of converted) {
      if ("general" in entry) {
        generals.set(entry.champion, [
          ...(generals.get(entry.champion) ?? []),
          entry.general,
        ]);
      } else {
        matchups.set(entry.champion, [
          ...(matchups.get(entry.champion) ?? []),
          entry.matchup,
        ]);
      }
    }
  }
  const files = new Map<string, ChampionTipsFile>();
  for (const champion of [
    ...new Set([...generals.keys(), ...matchups.keys()]),
  ].toSorted()) {
    files.set(
      champion,
      ChampionTipsFileSchema.parse({
        schemaVersion: CHAMPION_TIPS_SCHEMA_VERSION,
        champion,
        patch: meta.patch,
        model: meta.model,
        promptVersion: meta.promptVersion,
        general: (generals.get(champion) ?? []).toSorted(
          (a, b) => laneRank(a.lane) - laneRank(b.lane),
        ),
        matchups: (matchups.get(champion) ?? []).toSorted(
          (a, b) =>
            laneRank(a.lane) - laneRank(b.lane) ||
            byCode(a.opponent, b.opponent),
        ),
      }),
    );
  }
  return { files, failed };
}

/** The index of a set of champion files; `bytes` is each file's size on disk. */
export function buildIndex(
  files: ReadonlyMap<string, ChampionTipsFile>,
  bytes: ReadonlyMap<string, number>,
  meta: OutputMeta,
): ChampionTipsIndex {
  return {
    schemaVersion: CHAMPION_TIPS_SCHEMA_VERSION,
    ...meta,
    champions: [...files.entries()]
      .toSorted(([a], [b]) => byCode(a, b))
      .map(([key, file]) => {
        const tips = [...file.general, ...file.matchups].flatMap(
          (set) => set.tips,
        );
        return {
          key,
          file: championTipsPath(key),
          lanes: LANE_ORDER.filter((lane) =>
            [...file.general, ...file.matchups].some(
              (set) => set.lane === lane,
            ),
          ),
          generalSets: file.general.length,
          matchupSets: file.matchups.length,
          tips: tips.length,
          hiddenTips: tips.filter((tip) => tip.hidden === true).length,
          combos: file.general.reduce((sum, set) => sum + set.combos.length, 0),
          bytes: bytes.get(key) ?? 1,
        };
      }),
  };
}

function textIssues(
  id: string,
  text: string,
  refs: readonly TextRef[],
  index: FactIndex,
): string[] {
  return validateRefs(text, refs, index).map(
    (issue) => `${id}: ${issue.message}`,
  );
}

function comboFileIssues(combo: OutputCombo, index: FactIndex): string[] {
  const steps = combo.sequence.flatMap((step) =>
    step === "attack" ? [] : validateKey(step.kind, step.key, index),
  );
  return [
    ...textIssues(combo.id, combo.when, combo.whenRefs, index),
    ...textIssues(combo.id, combo.text, combo.textRefs, index),
    ...steps.map((issue) => `${combo.id}: ${issue.message}`),
  ];
}

/** Validate a parsed file's references against the facts; the CI check. */
export function fileIssues(file: ChampionTipsFile, index: FactIndex): string[] {
  return [
    ...[...file.general, ...file.matchups]
      .flatMap((set) => set.tips)
      .flatMap((tip) => textIssues(tip.id, tip.text, tip.refs, index)),
    ...file.general
      .flatMap((set) => set.combos)
      .flatMap((combo) => comboFileIssues(combo, index)),
  ];
}
