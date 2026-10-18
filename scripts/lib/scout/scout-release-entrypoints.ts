/** Entrypoints every newly built Scout site archive must contain, in both flavors. */
export const RELEASE_ENTRYPOINTS = [
  "index.html",
  "app/index.html",
  "docs/index.html",
  "404.html",
] as const;

export type ReleaseEntrypoint = (typeof RELEASE_ENTRYPOINTS)[number];

/** Derives verification capability from an immutable historical archive. */
export async function archiveEntrypoints(
  directory: string,
): Promise<ReleaseEntrypoint[]> {
  const present: ReleaseEntrypoint[] = [];
  for (const path of RELEASE_ENTRYPOINTS) {
    if (await Bun.file(`${directory}/${path}`).exists()) present.push(path);
  }
  return present;
}
