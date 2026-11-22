/** A code the server gives for a state or a reason, as a sentence-case phrase. */
export function phrase(code: string): string {
  const words = code.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function when(value: string): string {
  return new Date(value).toLocaleString();
}

/** The titles a file covers, named once each, in the order the review lists them. */
export function coveredTitles(
  media: readonly { id: string; title: string }[],
  mediaIds: readonly string[],
): string {
  return media
    .filter((item) => mediaIds.includes(item.id))
    .map((item) => item.title)
    .join(", ");
}
