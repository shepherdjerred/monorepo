export interface ReleaseProfile {
  schema: 1;
  channel: "stable" | "preview";
  manifest_url: string;
  public_keys: string[];
  publisher: string | null;
}

export function parseProfile(value: unknown): ReleaseProfile {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid release profile");
  const p = value as Record<string, unknown>;
  const fields = [
    "schema",
    "channel",
    "manifest_url",
    "public_keys",
    "publisher",
  ];
  if (
    Object.keys(p).some((k) => !fields.includes(k)) ||
    p.schema !== 1 ||
    (p.channel !== "stable" && p.channel !== "preview") ||
    p.manifest_url !== `https://glitter-boys.com/launcher/${p.channel}.json` ||
    !Array.isArray(p.public_keys) ||
    !p.public_keys.every(
      (k: unknown): k is string =>
        typeof k === "string" && /^[a-f0-9]{64}$/.test(k),
    ) ||
    (p.publisher !== null &&
      (typeof p.publisher !== "string" || p.publisher.length === 0))
  )
    throw new Error("Invalid release profile");
  if (
    (p.publisher === null) !== (p.public_keys.length === 0) ||
    (p.channel === "stable" && p.publisher === null)
  )
    throw new Error("A signed channel requires both publisher and public keys");
  return {
    schema: 1,
    channel: p.channel,
    manifest_url: p.manifest_url,
    public_keys: p.public_keys,
    publisher: p.publisher,
  };
}

export async function readProfile(root: string): Promise<ReleaseProfile> {
  return parseProfile(await Bun.file(`${root}/release-profile.json`).json());
}
