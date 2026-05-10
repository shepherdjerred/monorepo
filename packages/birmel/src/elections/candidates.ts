import path from "node:path";
import { readdir } from "node:fs/promises";

export async function getAllCandidates(): Promise<string[]> {
  const styleCardsDir = path.join(import.meta.dir, "../persona/style-cards");
  const files = await readdir(styleCardsDir);

  return files
    .filter((f) => f.endsWith("_style.json"))
    .map((f) => f.replace("_style.json", ""));
}

export async function selectRandomCandidates(
  min = 3,
  max = 5,
): Promise<string[]> {
  const allCandidates = await getAllCandidates();
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
