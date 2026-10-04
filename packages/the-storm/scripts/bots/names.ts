/**
 * Gamer-tag names with a 2014 feel, built from syllables and word lists rather
 * than copied from anyone. Candidates are filtered by the catalog regex and a
 * blocklist here, then by a Mojang profile lookup in the generator so no bot
 * wears a real player's name.
 */
import type { MojangNames } from "./mojang.ts";
import type { Rng } from "./random.ts";
import { ID_PATTERN, NAME_PATTERN, namesAreDistinct } from "./schema.ts";

/** How many candidates to try per accepted name before giving up on the lists. */
const MAX_CANDIDATES_PER_NAME = 200;

const ADJECTIVES = [
  "Shadow",
  "Dark",
  "Epic",
  "Frost",
  "Ember",
  "Rusty",
  "Swift",
  "Silent",
  "Lucky",
  "Pixel",
  "Turbo",
  "Grim",
  "Neon",
  "Rogue",
  "Mystic",
  "Toxic",
  "Royal",
  "Crimson",
  "Cobalt",
  "Dusty",
  "Jolly",
  "Spooky",
  "Hyper",
  "Static",
  "Vivid",
  "Lunar",
  "Solar",
  "Quiet",
  "Sneaky",
  "Dizzy",
] as const;

const NOUNS = [
  "Wolf",
  "Blaze",
  "Creeper",
  "Fuse",
  "Knight",
  "Ninja",
  "Pickaxe",
  "Arrow",
  "Golem",
  "Slime",
  "Raven",
  "Falcon",
  "Fox",
  "Bandit",
  "Rider",
  "Sniper",
  "Miner",
  "Hunter",
  "Viper",
  "Phantom",
  "Comet",
  "Storm",
  "Pumpkin",
  "Potato",
  "Waffle",
  "Noodle",
  "Badger",
  "Otter",
  "Lynx",
  "Moth",
] as const;

const ONSETS = [
  "k",
  "z",
  "v",
  "r",
  "t",
  "n",
  "m",
  "d",
  "br",
  "kr",
  "gr",
  "sk",
  "th",
  "sh",
  "x",
  "j",
  "l",
  "p",
] as const;
const VOWELS = ["a", "e", "i", "o", "u", "y", "ae", "ai", "io", "ou"] as const;
const CODAS = [
  "",
  "",
  "n",
  "x",
  "r",
  "k",
  "sh",
  "th",
  "z",
  "l",
  "m",
  "st",
] as const;

const SUFFIXES = ["HD", "MC", "PvP", "Gaming", "YT", "Pro", "TV"] as const;
const PREFIXES = [
  "Mr",
  "Sir",
  "The",
  "Its",
  "Lil",
  "Dr",
  "Captain",
  "xX",
] as const;

/**
 * Lower-case substrings no name may contain. Short and deliberately broad; the
 * generator also rejects anything a human would not want on a server.
 */
const BLOCKLIST = [
  "fuck",
  "fuk",
  "shit",
  "sh1t",
  "cunt",
  "dick",
  "cock",
  "penis",
  "pussy",
  "ass",
  "arse",
  "anal",
  "anus",
  "sex",
  "porn",
  "rape",
  "cum",
  "jizz",
  "fag",
  "homo",
  "dyke",
  "tranny",
  "nigg",
  "nig",
  "negro",
  "chink",
  "spic",
  "kike",
  "paki",
  "nazi",
  "hitler",
  "kkk",
  "isis",
  "jihad",
  "kill",
  "die",
  "suicid",
  "whore",
  "slut",
  "bitch",
  "bastard",
  "damn",
  "hell",
  "satan",
  "666",
  "420",
  "69",
  "weed",
  "meth",
  "coke",
  "retard",
  "tard",
  "spaz",
  "idiot",
  "stupid",
  "gay",
  "lesb",
  "trans",
  "jew",
  "muslim",
  "allah",
  "jesus",
  "christ",
  "god",
  "notch",
  "jeb",
  "dinnerbone",
  "mojang",
  "herobrine",
  "steve",
  "alex",
] as const;

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function syllable(rng: Rng): string {
  return `${rng.pick(ONSETS)}${rng.pick(VOWELS)}${rng.pick(CODAS)}`;
}

/** A made-up word of two or three syllables, such as `Kravith` or `Zonex`. */
function coinedWord(rng: Rng): string {
  const count = rng.chance(0.7) ? 2 : 3;
  let word = "";
  for (let i = 0; i < count; i++) {
    word += syllable(rng);
  }
  return capitalize(word);
}

function twoDigits(rng: Rng): string {
  return String(rng.int(100)).padStart(2, "0");
}

/** One candidate name in one of several era-typical shapes. */
export function nextCandidateName(rng: Rng): string {
  switch (rng.int(10)) {
    case 0: {
      return `${rng.pick(ADJECTIVES)}${rng.pick(NOUNS)}${twoDigits(rng)}`;
    }
    case 1: {
      return `${rng.pick(ADJECTIVES)}_${rng.pick(NOUNS)}`;
    }
    case 2: {
      return `xX${rng.pick(NOUNS)}${rng.pick(NOUNS)}Xx`;
    }
    case 3: {
      return `${coinedWord(rng)}${rng.pick(SUFFIXES)}`;
    }
    case 4: {
      return `${rng.pick(PREFIXES)}${coinedWord(rng)}`;
    }
    case 5: {
      return `${coinedWord(rng)}_${twoDigits(rng)}`;
    }
    case 6: {
      return `${coinedWord(rng)}${rng.pick(NOUNS)}`;
    }
    case 7: {
      return `${rng.pick(NOUNS)}${rng.pick(NOUNS)}${String(rng.int(10))}`;
    }
    case 8: {
      return `${coinedWord(rng)}${coinedWord(rng).toLowerCase()}`;
    }
    default: {
      return `${rng.pick(ADJECTIVES)}${coinedWord(rng)}`;
    }
  }
}

/** The blocklist entry a name contains, if any. */
export function blockedTerm(name: string): string | undefined {
  const lower = name.toLowerCase();
  return BLOCKLIST.find((term) => lower.includes(term));
}

/** The catalog id for a name: lower case with `-` for `_`. */
export function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replaceAll("_", "-")
    .replaceAll(/-+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

/** Whether a candidate passes every local rule (regex, blocklist, usable id). */
export function nameIsAcceptable(name: string): boolean {
  return (
    NAME_PATTERN.test(name) &&
    !name.startsWith(".") &&
    blockedTerm(name) === undefined &&
    ID_PATTERN.test(nameToId(name))
  );
}

export type Rejections = { local: number; similar: number; taken: number };

export type NameRequest = {
  count: number;
  /** Checks each candidate is free; undefined when offline. */
  mojang: MojangNames | undefined;
  /** Names already in the catalog, which new names must stay away from. */
  existing: readonly string[];
  /** Counts why candidates were turned down. */
  rejections: Rejections;
};

/** `count` names that pass every rule, distinct from `existing`, in order. */
export async function chooseNames(
  rng: Rng,
  request: NameRequest,
): Promise<string[]> {
  const { count, mojang, existing, rejections } = request;
  const chosen: string[] = [];
  let tried = 0;
  while (chosen.length < count) {
    if (tried > MAX_CANDIDATES_PER_NAME * count) {
      throw new Error(
        `could not find ${String(count)} acceptable names from the word lists`,
      );
    }
    tried++;
    const candidate = nextCandidateName(rng);
    if (!nameIsAcceptable(candidate)) {
      rejections.local++;
      continue;
    }
    if (
      ![...existing, ...chosen].every((name) =>
        namesAreDistinct(name, candidate),
      )
    ) {
      rejections.similar++;
      continue;
    }
    if (mojang !== undefined && (await mojang.status(candidate)) === "taken") {
      rejections.taken++;
      console.error(`  name ${candidate} is taken; skipping`);
      continue;
    }
    chosen.push(candidate);
  }
  return chosen;
}
