/** Profile identities must have been resolved against the asker's servers. */
export function authorizedProfileLinks(
  markdown: string,
  authorized: ReadonlySet<string>,
): string {
  return markdown.replaceAll(
    /\[([^\]]+)\]\((https:\/\/(?:beta\.)?scout-for-lol\.com)?(\/app\/players\/\d+)\)/gu,
    (_match, label: string, _origin: string | undefined, path: string) =>
      authorized.has(path) ? `[${label}](${path})` : label,
  );
}
