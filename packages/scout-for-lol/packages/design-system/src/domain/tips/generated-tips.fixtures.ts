import ahriJson from "@scout-for-lol/data/tips/generated/champions/Ahri.json" with { type: "json" };
import cassiopeiaJson from "@scout-for-lol/data/tips/generated/champions/Cassiopeia.json" with { type: "json" };
import jaxJson from "@scout-for-lol/data/tips/generated/champions/Jax.json" with { type: "json" };
import talonJson from "@scout-for-lol/data/tips/generated/champions/Talon.json" with { type: "json" };
import warwickJson from "@scout-for-lol/data/tips/generated/champions/Warwick.json" with { type: "json" };
import zedJson from "@scout-for-lol/data/tips/generated/champions/Zed.json" with { type: "json" };
import type { Lane } from "@scout-for-lol/data/model/riot/lane.ts";
import { GameFactSchema } from "@scout-for-lol/data/game-facts/schema.ts";
import {
  ChampionTipsFileSchema,
  OutputComboRefSchema,
  type ChampionTipsFile,
  type OutputGeneralSet,
  type OutputMatchupSet,
  type TextRef,
} from "@scout-for-lol/data/tips/output/champion-tips.ts";
import type { GameFactLoader } from "#src/domain/tooltips/game-fact-store.ts";
import type { ComboRefData } from "#src/domain/tips/combo-row.tsx";

/**
 * The stories' data. Every tip and combo is read from the generated champion
 * files in the data package and parsed by their schema; nothing is retyped.
 * The tooltips behind them load the generated game-fact files the same way.
 */

export const ahri = ChampionTipsFileSchema.parse(ahriJson);
export const cassiopeia = ChampionTipsFileSchema.parse(cassiopeiaJson);
export const jax = ChampionTipsFileSchema.parse(jaxJson);
export const talon = ChampionTipsFileSchema.parse(talonJson);
export const warwick = ChampionTipsFileSchema.parse(warwickJson);
export const zed = ChampionTipsFileSchema.parse(zedJson);

export const generatedFiles: readonly ChampionTipsFile[] = [
  ahri,
  cassiopeia,
  jax,
  talon,
  warwick,
  zed,
];

export function generalSet(
  file: ChampionTipsFile,
  lane: Lane,
): OutputGeneralSet {
  const set = file.general.find((candidate) => candidate.lane === lane);
  if (set === undefined) {
    throw new Error(`${file.champion} has no general tips for ${lane}`);
  }
  return set;
}

export function matchupSet(
  file: ChampionTipsFile,
  lane: Lane,
  opponent: string,
): OutputMatchupSet {
  const set = file.matchups.find(
    (candidate) => candidate.lane === lane && candidate.opponent === opponent,
  );
  if (set === undefined) {
    throw new Error(
      `${file.champion} has no ${lane} matchup tips against ${opponent}`,
    );
  }
  return set;
}

/** The sets the stories show, each beside the set from the other side. */
export const ahriMiddle = generalSet(ahri, "middle");
export const ahriIntoZed = matchupSet(ahri, "middle", "Zed");
export const zedIntoAhri = matchupSet(zed, "middle", "Ahri");
export const cassiopeiaMiddle = generalSet(cassiopeia, "middle");
export const cassiopeiaIntoTalon = matchupSet(cassiopeia, "middle", "Talon");
export const talonIntoCassiopeia = matchupSet(talon, "middle", "Cassiopeia");
export const jaxJungle = generalSet(jax, "jungle");
export const jaxTop = generalSet(jax, "top");
export const jaxIntoTalon = matchupSet(jax, "jungle", "Talon");
export const talonIntoJax = matchupSet(talon, "jungle", "Jax");
export const talonJungle = generalSet(talon, "jungle");
export const warwickJungle = generalSet(warwick, "jungle");
export const warwickIntoTalon = matchupSet(warwick, "jungle", "Talon");
export const talonIntoWarwick = matchupSet(talon, "jungle", "Warwick");

/** Every set a story renders, for checks over the whole fixture. */
export const storySets: readonly (OutputGeneralSet | OutputMatchupSet)[] = [
  ahriMiddle,
  ahriIntoZed,
  zedIntoAhri,
  cassiopeiaMiddle,
  cassiopeiaIntoTalon,
  talonIntoCassiopeia,
  jaxJungle,
  jaxTop,
  jaxIntoTalon,
  talonIntoJax,
  talonJungle,
  warwickJungle,
  warwickIntoTalon,
  talonIntoWarwick,
];

function refIn(
  text: string,
  phrase: string,
  kind: TextRef["kind"],
  key: string,
): TextRef {
  const start = text.indexOf(phrase);
  if (start === -1) {
    throw new Error(`"${phrase}" is not in "${text}"`);
  }
  return { kind, key, start, end: start + phrase.length };
}

const jaxStandInNote =
  "Counter Strike dodges Talon's autos, and Leap Strike then stuns him.";

/**
 * The first full tips run wrote no combo references: every matchup side has
 * `comboRefs: []`. This is one, for the ComboRef stories, pointing at a real
 * combo of Jax's and the schema's shape. Only the note is written here.
 */
export const jaxStandInComboRef: ComboRefData = OutputComboRefSchema.parse({
  comboId: jaxJungle.combos[1]?.id,
  note: jaxStandInNote,
  refs: [
    refIn(jaxStandInNote, "Counter Strike", "ability", "Jax-E"),
    refIn(jaxStandInNote, "Leap Strike", "ability", "Jax-Q"),
    refIn(jaxStandInNote, "stuns", "keyword", "stunned"),
  ],
});

const factModules = import.meta.glob<{ default: unknown }>(
  "../../../../data/src/data-dragon/assets/facts/**/*.json",
);
const FACTS_PREFIX = "../../../../data/src/data-dragon/assets/facts";

/**
 * A loader over the generated game-fact files, after `delayMs`. A fact that
 * has no file is a missing fixture and rejects, like a failed request.
 */
export function generatedFactLoader(delayMs = 0): GameFactLoader {
  return async (kind, key, { signal }) => {
    const load = factModules[`${FACTS_PREFIX}/${kind}/${key}.json`];
    if (load === undefined) {
      throw new Error(`No generated game fact for ${kind}/${key}`);
    }
    if (delayMs > 0) {
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(resolve, delayMs);
      });
    }
    signal.throwIfAborted();
    const file = await load();
    return GameFactSchema.parse(file.default);
  };
}
