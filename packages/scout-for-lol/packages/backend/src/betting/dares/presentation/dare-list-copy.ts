import { z } from "zod";

export const DareStatusPhrasesSchema = z.record(
  z.string().min(1).max(64),
  z.string().trim().min(1).max(80),
);
export type DareStatusPhrases = z.infer<typeof DareStatusPhrasesSchema>;

export function parseStoredStatusPhrases(
  raw: string | null,
): DareStatusPhrases | null {
  if (raw === null) return null;
  const parsed: unknown = JSON.parse(raw);
  return DareStatusPhrasesSchema.parse(parsed);
}

export function storedStatusPhrasesJson(
  phrases: DareStatusPhrases | null,
): string | null {
  return phrases === null ? null : JSON.stringify(phrases);
}

export function statusPhraseCoverageIssues(
  gameSetNames: readonly string[],
  phrases: DareStatusPhrases | undefined,
): string[] {
  if (phrases === undefined) return [];
  const issues: string[] = [];
  const named = new Set(gameSetNames);
  for (const key of Object.keys(phrases)) {
    if (!named.has(key)) {
      issues.push(`statusPhrases names unknown game set ${key}.`);
    }
  }
  for (const name of gameSetNames) {
    if (phrases[name] === undefined) {
      issues.push(`statusPhrases is missing English for ${name}.`);
    }
  }
  return issues;
}
