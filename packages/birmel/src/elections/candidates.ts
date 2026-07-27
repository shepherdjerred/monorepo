import { listStyleCardNames } from "@shepherdjerred/glitter-context";

export function getAllCandidates(): string[] {
  return listStyleCardNames();
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
