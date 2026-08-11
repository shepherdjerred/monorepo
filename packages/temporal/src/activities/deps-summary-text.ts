export function dependencyNoteText(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length < 40
    ? undefined
    : trimmed.slice(0, 4000);
}

export function firstWords(value: string, maximum: number): string {
  return value.trim().split(/\s+/).slice(0, maximum).join(" ");
}
