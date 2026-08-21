function decodeXmlAttribute(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

export function parseExportedFeedFilters(
  opml: string,
): Map<string, string | undefined> {
  const filtersByUrl = new Map<string, string | undefined>();
  for (const tag of opml.matchAll(/<outline([^>]+xmlUrl="[^"]*"[^>]*)\/>/g)) {
    const rawAttributes = tag[1];
    if (rawAttributes === undefined) {
      throw new Error("FreshRSS OPML export contained an invalid feed outline");
    }
    const attributes = new Map<string, string>();
    for (const attribute of rawAttributes.matchAll(
      /([\w:][\w.:-]*)="([^"]*)"/g,
    )) {
      const name = attribute[1];
      const value = attribute[2];
      if (name === undefined || value === undefined) {
        throw new Error("FreshRSS OPML export contained an invalid attribute");
      }
      attributes.set(name, decodeXmlAttribute(value));
    }
    const url = attributes.get("xmlUrl");
    if (url === undefined) {
      throw new Error("FreshRSS OPML feed outline did not contain xmlUrl");
    }
    filtersByUrl.set(url, attributes.get("frss:filtersActionRead"));
  }
  return filtersByUrl;
}
