import { createMatch, type MatchState } from "@castle-casters/core";
import { gameSaveSchema } from "@castle-casters/core/schemas";

const storageKey = "castle-casters-web:v1";

export function loadSavedMatch(): MatchState {
  const raw = localStorage.getItem(storageKey);
  if (raw === null) {
    return createMatch();
  }
  const parsed = gameSaveSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    return createMatch();
  }
  return parsed.data.match;
}

export function saveMatch(match: MatchState): void {
  localStorage.setItem(
    storageKey,
    JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      match,
    }),
  );
}

export function clearSavedMatch(): void {
  localStorage.removeItem(storageKey);
}
