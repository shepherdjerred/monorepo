import { z } from "zod";
import { fetchJson } from "./fetch.ts";
import {
  humanizeIdentifier,
  type KnowledgeRecord,
  type Sources,
} from "./model.ts";

const QueryResponseSchema = z.object({
  query: z.object({
    pages: z
      .array(
        z.object({
          pageid: z.number().int(),
          title: z.string(),
          extract: z.string().min(1),
          revisions: z
            .array(
              z.object({
                revid: z.number().int(),
                timestamp: z.iso.datetime(),
              }),
            )
            .min(1),
        }),
      )
      .length(1),
  }),
});

const MAX_BODY_CHARS = 6000;

function chunkText(text: string): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
  const chunks: string[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (paragraph.length > MAX_BODY_CHARS) {
      throw new Error(
        `Bulbapedia paragraph exceeds ${String(MAX_BODY_CHARS)} characters`,
      );
    }
    if (`${current}\n\n${paragraph}`.trim().length > MAX_BODY_CHARS) {
      chunks.push(current);
      current = paragraph;
    } else {
      current = `${current}\n\n${paragraph}`.trim();
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

function pageSlug(title: string): string {
  return title
    .replace("Walkthrough:Pokémon Emerald", "emerald")
    .replaceAll("/", "-")
    .replaceAll(" ", "-")
    .toLowerCase();
}

export async function buildBulbapediaRecords(
  sources: Sources,
): Promise<KnowledgeRecord[]> {
  const records: KnowledgeRecord[] = [];

  for (const pin of sources.bulbapedia.pages) {
    const url = new URL(sources.bulbapedia.api);
    url.search = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      prop: "extracts|revisions",
      explaintext: "1",
      exsectionformat: "plain",
      rvprop: "ids|timestamp",
      titles: pin.title,
    }).toString();
    const response = QueryResponseSchema.parse(await fetchJson(url.toString()));
    const page = response.query.pages.at(0);
    if (page === undefined) {
      throw new Error(`Bulbapedia omitted ${pin.title}`);
    }
    const revision = page.revisions.at(0);
    if (
      revision?.revid !== pin.revision ||
      revision.timestamp !== pin.timestamp
    ) {
      throw new Error(
        `Bulbapedia revision drift for ${pin.title}; update knowledge/sources.json intentionally`,
      );
    }
    const chunks = chunkText(page.extract);
    chunks.forEach((body, index) => {
      const sequence = index + 1;
      records.push({
        id: `progression:bulbapedia:${pageSlug(pin.title)}:${String(sequence)}`,
        domain: "progression",
        title: `${pin.title} (${String(sequence)}/${String(chunks.length)})`,
        aliases: [
          pin.title,
          humanizeIdentifier(pageSlug(pin.title)),
          `Emerald walkthrough ${pin.title.split("/").at(-1) ?? "overview"}`,
        ],
        tags: ["walkthrough", "pokemon-emerald", pageSlug(pin.title)],
        body,
        source: {
          id: "bulbapedia",
          url: `https://bulbapedia.bulbagarden.net/wiki/${encodeURI(pin.title.replaceAll(" ", "_"))}?oldid=${String(pin.revision)}`,
          license: sources.bulbapedia.license,
          revision: String(pin.revision),
        },
      });
    });
  }
  return records;
}
