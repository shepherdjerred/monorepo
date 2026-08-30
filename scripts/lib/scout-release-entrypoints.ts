const BASE_RELEASE_ENTRYPOINTS = [
  "index.html",
  "app/index.html",
  "docs/index.html",
] as const;
const CUSTOMS_ENTRYPOINT = "customs/index.html" as const;
const KNOWN_RELEASE_ENTRYPOINTS = [
  ...BASE_RELEASE_ENTRYPOINTS,
  CUSTOMS_ENTRYPOINT,
] as const;

export type ReleaseEntrypoint = (typeof KNOWN_RELEASE_ENTRYPOINTS)[number];

export function requiredReleaseEntrypoints(
  flavor: "prod" | "beta",
): readonly ReleaseEntrypoint[] {
  return flavor === "beta"
    ? KNOWN_RELEASE_ENTRYPOINTS
    : BASE_RELEASE_ENTRYPOINTS;
}

/** Derives verification capability from an immutable historical archive. */
export async function archiveEntrypoints(
  directory: string,
): Promise<ReleaseEntrypoint[]> {
  const present: ReleaseEntrypoint[] = [];
  for (const path of KNOWN_RELEASE_ENTRYPOINTS) {
    if (await Bun.file(`${directory}/${path}`).exists()) present.push(path);
  }
  return present;
}
