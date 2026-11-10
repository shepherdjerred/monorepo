const TAILNET_NAME = /\b([a-z0-9-]+)\.([a-z0-9-]+\.ts\.net)\b/g;

/** Every `<host>.<tailnet domain>` name in a text. */
export function tailnetNamesIn(
  source: string,
): { host: string; domain: string }[] {
  return [...source.matchAll(TAILNET_NAME)].map((match) => ({
    host: match[1] ?? "",
    domain: match[2] ?? "",
  }));
}
