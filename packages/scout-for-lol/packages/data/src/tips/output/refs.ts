import { z } from "zod";
import type { GameFactKind } from "#src/game-facts/schema.ts";
import type { Cite, GlossaryEntry, GlossaryId } from "#src/tips/schema.ts";
import type { TextRef } from "#src/tips/output/champion-tips.ts";

/**
 * References from a tip's text to game facts, with the span each covers. The
 * facts are the generated files under `src/data-dragon/assets/facts/<kind>/`;
 * a reference that names no file there (or no glossary entry, for a keyword) is
 * a broken contract and fails the unit.
 */

const FACTS_ROOT = `${import.meta.dir}/../../data-dragon/assets/facts`;

/** What exists to refer to: every key by kind, and the display names of the kinds found by name in text. */
export type FactIndex = {
  keys: Record<GameFactKind, ReadonlySet<string>>;
  /** Lowercase display name to key, for items, runes, summoner spells and champions. */
  names: Record<
    "item" | "rune" | "summoner-spell" | "champion",
    ReadonlyMap<string, string>
  >;
};

const NamedFactSchema = z.object({ name: z.string(), key: z.string() });

export async function loadFactIndex(
  keywords: Iterable<string> = [],
): Promise<FactIndex> {
  const kinds = [
    "champion",
    "ability",
    "item",
    "rune",
    "summoner-spell",
  ] as const;
  const keys = new Map<GameFactKind, Set<string>>(
    kinds.map((kind) => [kind, new Set<string>()]),
  );
  const names = new Map<string, Map<string, string>>(
    ["item", "rune", "summoner-spell", "champion"].map((kind) => [
      kind,
      new Map(),
    ]),
  );
  await Promise.all(
    kinds.map(async (kind) => {
      const found: string[] = [];
      for await (const file of new Bun.Glob("*.json").scan({
        cwd: `${FACTS_ROOT}/${kind}`,
      })) {
        found.push(file);
      }
      await Promise.all(
        found.map(async (file) => {
          const key = file.slice(0, -".json".length);
          keys.get(kind)?.add(key);
          const target = names.get(kind);
          if (target !== undefined) {
            const fact = NamedFactSchema.parse(
              await Bun.file(`${FACTS_ROOT}/${kind}/${file}`).json(),
            );
            // Game modes repeat a name under other ids (Flash is 4, 74 and 2202); the classic id is the lowest.
            const name = fact.name.toLowerCase();
            const known = target.get(name);
            if (known === undefined || Number(fact.key) < Number(known)) {
              target.set(name, fact.key);
            }
          }
        }),
      );
    }),
  );
  const empty = new Set<string>();
  return {
    keys: {
      champion: keys.get("champion") ?? empty,
      ability: keys.get("ability") ?? empty,
      item: keys.get("item") ?? empty,
      rune: keys.get("rune") ?? empty,
      "summoner-spell": keys.get("summoner-spell") ?? empty,
      keyword: new Set(keywords),
    },
    names: {
      item: names.get("item") ?? new Map(),
      rune: names.get("rune") ?? new Map(),
      "summoner-spell": names.get("summoner-spell") ?? new Map(),
      champion: names.get("champion") ?? new Map(),
    },
  };
}

const escapeRegExp = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

/** Every whole-word occurrence of `phrase` in `text`, case-insensitive. */
function occurrences(text: string, phrase: string): [number, number][] {
  if (phrase.length === 0) {
    return [];
  }
  const pattern = new RegExp(
    String.raw`(?<![\p{L}\p{N}])${escapeRegExp(phrase)}(?![\p{L}\p{N}])`,
    "giu",
  );
  return [...text.matchAll(pattern)].map((match) => [
    match.index,
    match.index + match[0].length,
  ]);
}

/** A phrase's fact key, allowing a trailing possessive ("Syndra's"); `trim` is how much of the phrase the key covers. */
function lookupName(
  phrase: string,
  names: ReadonlyMap<string, string>,
): { key: string; trim: number } | undefined {
  const normal = phrase.toLowerCase().replaceAll("’", "'");
  const whole = names.get(normal);
  if (whole !== undefined) {
    return { key: whole, trim: 0 };
  }
  const bare = /['’]s$/u.test(phrase)
    ? names.get(normal.slice(0, -2))
    : undefined;
  return bare === undefined ? undefined : { key: bare, trim: 2 };
}

/** The longest names first, so "Zhonya's Hourglass" is found before a shorter name inside it. */
function mentionsByName(
  text: string,
  kind: "item" | "rune" | "summoner-spell" | "champion",
  names: ReadonlyMap<string, string>,
  minLength: number,
): TextRef[] {
  const refs: TextRef[] = [];
  const words = [...text.matchAll(/[\p{L}\p{N}'’-]+/gu)];
  let from = 0;
  while (from < words.length) {
    let advanced = 1;
    for (let length = 5; length >= 1; length -= 1) {
      const first = words[from];
      const last = words[from + length - 1];
      if (first === undefined || last === undefined) {
        continue;
      }
      const start = first.index;
      const end = last.index + last[0].length;
      const phrase = text.slice(start, end);
      // A capitalised phrase, so "flash" the word is not Flash the spell.
      const found =
        phrase.length >= minLength && /^\p{Lu}/u.test(phrase)
          ? lookupName(phrase, names)
          : undefined;
      if (found !== undefined) {
        refs.push({ kind, key: found.key, start, end: end - found.trim });
        advanced = length;
        break;
      }
    }
    from += advanced;
  }
  return refs;
}

export type RefContext = {
  index: FactIndex;
  glossary: ReadonlyMap<GlossaryId, GlossaryEntry>;
  /** The champion key of each champion id a cite may name. */
  championKeyOf: (championId: number) => string | undefined;
};

/** The key of an ability fact: `<champion key>-<slot>`. */
export const abilityFactKey = (championKey: string, slot: string): string =>
  `${championKey}-${slot === "P" ? "passive" : slot}`;

function abilityRefs(
  text: string,
  cite: Extract<Cite, { kind: "ability" }>,
  context: RefContext,
): TextRef[] {
  const championKey = context.championKeyOf(cite.champion);
  if (championKey === undefined) {
    return [];
  }
  const key = abilityFactKey(championKey, cite.slot);
  return occurrences(text, cite.name).map(([start, end]) => ({
    kind: "ability",
    key,
    start,
    end,
  }));
}

function keywordRefs(
  text: string,
  cite: Extract<Cite, { kind: "keyword" }>,
  context: RefContext,
): TextRef[] {
  const entry = context.glossary.get(cite.id);
  return [entry?.term ?? "", ...(entry?.aliases ?? [])].flatMap((phrase) =>
    occurrences(text, phrase).map(([start, end]) => ({
      kind: "keyword" as const,
      key: cite.id,
      start,
      end,
    })),
  );
}

/** References the cites ask for: a cited ability by its name, a cited keyword by its term or an alias. */
function citedRefs(
  text: string,
  cites: readonly Cite[],
  context: RefContext,
): { abilities: TextRef[]; keywords: TextRef[] } {
  return {
    abilities: cites.flatMap((cite) =>
      cite.kind === "ability" ? abilityRefs(text, cite, context) : [],
    ),
    keywords: cites.flatMap((cite) =>
      cite.kind === "keyword" ? keywordRefs(text, cite, context) : [],
    ),
  };
}

/** Keep each reference unless it overlaps one kept before it (the order given is the priority). */
function dropOverlaps(refs: readonly TextRef[]): TextRef[] {
  const kept: TextRef[] = [];
  for (const ref of refs) {
    if (!kept.some((other) => ref.start < other.end && other.start < ref.end)) {
      kept.push(ref);
    }
  }
  return kept.toSorted((left, right) => left.start - right.start);
}

/**
 * The references in a text: every cited ability by its name, every cited
 * keyword by its term or an alias, and every champion, item, rune and summoner
 * spell the text names. Where two overlap the earlier kind in that order wins.
 */
export function refsFor(
  text: string,
  cites: readonly Cite[],
  context: RefContext,
): TextRef[] {
  const cited = citedRefs(text, cites, context);
  return dropOverlaps([
    ...cited.abilities,
    ...mentionsByName(
      text,
      "summoner-spell",
      context.index.names["summoner-spell"],
      3,
    ),
    ...mentionsByName(text, "item", context.index.names.item, 6),
    ...mentionsByName(text, "rune", context.index.names.rune, 5),
    ...mentionsByName(text, "champion", context.index.names.champion, 3),
    ...cited.keywords,
  ]);
}

export type RefIssue = { message: string };

/** One reference against the facts and the text. */
function refIssues(
  text: string,
  ref: TextRef,
  next: TextRef | undefined,
  index: FactIndex,
): RefIssue[] {
  const messages = [
    index.keys[ref.kind].has(ref.key)
      ? undefined
      : `${ref.kind} reference ${ref.key} resolves to no game fact`,
    ref.end > text.length
      ? `${ref.kind} ${ref.key} spans ${ref.start.toString()}-${ref.end.toString()}, past the ${text.length.toString()} characters of the text`
      : undefined,
    next !== undefined && next.start < ref.end
      ? `${ref.key} and ${next.key} overlap in the text`
      : undefined,
  ];
  return messages.flatMap((message) =>
    message === undefined ? [] : [{ message }],
  );
}

/** Every reference names an existing fact and a valid span of the text, and none overlap. */
export function validateRefs(
  text: string,
  refs: readonly TextRef[],
  index: FactIndex,
): RefIssue[] {
  const sorted = refs.toSorted((left, right) => left.start - right.start);
  return sorted.flatMap((ref, position) =>
    refIssues(text, ref, sorted[position + 1], index),
  );
}

/** A key reference with no span, as a combo step names an ability, item or spell. */
export function validateKey(
  kind: GameFactKind,
  key: string,
  index: FactIndex,
): RefIssue[] {
  return index.keys[kind].has(key)
    ? []
    : [{ message: `${kind} reference ${key} resolves to no game fact` }];
}
