import path from "node:path";
// eslint-disable-next-line no-restricted-imports -- readdirSync has no Bun equivalent for directory listing
import { readdirSync } from "node:fs";

export function getAllCandidates(): string[] {
  const styleCardsDir = path.join(import.meta.dir, "../persona/style-cards");
  const files = readdirSync(styleCardsDir);

  return files
    .filter((f) => f.endsWith("_style.json"))
    .map((f) => f.replace("_style.json", ""));
}

export function selectRandomCandidates(min = 3, max = 5): string[] {
  const allCandidates = getAllCandidates();
  const count = Math.floor(Math.random() * (max - min + 1)) + min;

  // Shuffle and select
  const shuffled = [...allCandidates].toSorted(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

export function createElectionAnswers(
  candidates: string[],
): { text: string }[] {
  return candidates.map((name) => ({
    text: name.charAt(0).toUpperCase() + name.slice(1),
  }));
}
