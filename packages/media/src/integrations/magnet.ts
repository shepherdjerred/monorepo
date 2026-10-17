/** Validate the complete alias set before any downloader observation or mutation. */
export function magnetTorrentIds(uri: string, expectedHash: string): string[] {
  const magnet = new URL(uri);
  if (magnet.protocol !== "magnet:") throw new Error("Expected a magnet URI");
  const v1 = new Set<string>();
  const v2 = new Set<string>();
  for (const value of magnet.searchParams.getAll("xt")) {
    const identity = value.toLowerCase();
    if (identity.startsWith("urn:btih:")) {
      if (!/^urn:btih:[a-f0-9]{40}$/u.test(identity))
        throw new Error("Malformed magnet v1 identity");
      v1.add(identity.slice(9));
    } else if (identity.startsWith("urn:btmh:")) {
      if (!/^urn:btmh:1220[a-f0-9]{64}$/u.test(identity))
        throw new Error("Malformed magnet v2 identity");
      v2.add(identity.slice(13));
    }
  }
  if (v1.size > 1 || v2.size > 1)
    throw new Error("Conflicting magnet identities");
  if (!v1.has(expectedHash) && !v2.has(expectedHash))
    throw new Error("Magnet identity does not match acquisition hash");
  return [...v1, ...[...v2].map((hash) => hash.slice(0, 40))];
}
