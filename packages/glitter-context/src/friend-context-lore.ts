export type ParsedLoreSection = {
  id: string;
  title: string;
  markdown: string;
  searchableText: string;
  sourceOrder: number;
};

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US");
}

function slugify(value: string): string {
  const slug = normalize(value)
    .normalize("NFKD")
    .replaceAll(/[^\p{L}\p{N}]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");
  if (slug.length === 0) {
    throw new Error(`cannot create a lore section id from ${value}`);
  }
  return slug;
}

export function parseLoreSections(markdown: string): ParsedLoreSection[] {
  const sections: ParsedLoreSection[] = [];
  const duplicateCounts = new Map<string, number>();
  let year: string | undefined;
  let subdivision: string | undefined;
  let bodyLines: string[] = [];

  function flush(): void {
    const body = bodyLines.join("\n").trim();
    bodyLines = [];
    if (year === undefined || body.length === 0) {
      return;
    }

    const title = subdivision === undefined ? year : `${year} — ${subdivision}`;
    const baseId = slugify(title);
    const occurrence = (duplicateCounts.get(baseId) ?? 0) + 1;
    duplicateCounts.set(baseId, occurrence);
    const id = occurrence === 1 ? baseId : `${baseId}-${String(occurrence)}`;
    const sectionMarkdown = `### ${title}\n${body}`;
    sections.push({
      id,
      title,
      markdown: sectionMarkdown,
      searchableText: normalize(`${title}\n${body}`),
      sourceOrder: sections.length,
    });
  }

  for (const line of markdown.split("\n")) {
    const yearMatch = /^### (.+)$/u.exec(line);
    if (yearMatch !== null) {
      flush();
      const matchedYear = yearMatch[1];
      if (matchedYear === undefined) {
        throw new Error("lore year heading did not contain a value");
      }
      year = matchedYear.trim();
      subdivision = undefined;
      continue;
    }

    const subdivisionMatch = /^\*\*([^*]+)\*\*$/u.exec(line);
    if (year !== undefined && subdivisionMatch !== null) {
      flush();
      const matchedSubdivision = subdivisionMatch[1];
      if (matchedSubdivision === undefined) {
        throw new Error("lore subdivision heading did not contain a value");
      }
      subdivision = matchedSubdivision.trim();
      continue;
    }

    if (year !== undefined) {
      bodyLines.push(line);
    }
  }
  flush();
  return sections;
}
