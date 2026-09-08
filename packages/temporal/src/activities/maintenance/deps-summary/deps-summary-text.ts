export function dependencyNoteText(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length < 40
    ? undefined
    : trimmed.slice(0, 4000);
}
