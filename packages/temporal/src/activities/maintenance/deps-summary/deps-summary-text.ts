import { graphemePrefix } from "@shepherdjerred/text";

export function dependencyNoteText(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length < 40
    ? undefined
    : graphemePrefix(trimmed, 4000);
}
