import { z } from "zod";
import { fetchJson } from "./fetch.ts";
import {
  humanizeIdentifier,
  type KnowledgeRecord,
  type Sources,
} from "./model.ts";

const ParseResponseSchema = z.object({
  parse: z.object({
    pageid: z.number().int(),
    title: z.string().min(1),
    revid: z.number().int().positive(),
    text: z.string().min(1),
  }),
});

const MAX_BODY_CHARS = 6000;
export const BULBAPEDIA_REQUEST_DELAY_MS = 5000;
type BulbapediaPagePin = Sources["bulbapedia"]["pages"][number];
type BulbapediaPage = z.infer<typeof ParseResponseSchema>["parse"];

const HTML_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", "\u{A0}"],
  ["quot", '"'],
]);

function decodeHtmlEntities(text: string): string {
  return text.replaceAll(
    /&(#(?:x[\dA-F]+|\d+)|[A-Z][\dA-Z]+);/gi,
    (entity, name: string) => {
      if (name.startsWith("#")) {
        const hexadecimal = name[1]?.toLowerCase() === "x";
        const digits = name.slice(hexadecimal ? 2 : 1);
        const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
        if (
          !Number.isInteger(codePoint) ||
          codePoint <= 0 ||
          codePoint > 0x10_ff_ff ||
          (codePoint >= 0xd8_00 && codePoint <= 0xdf_ff)
        ) {
          throw new Error(`invalid HTML entity ${entity}`);
        }
        return String.fromCodePoint(codePoint);
      }
      const decoded = HTML_ENTITIES.get(name.toLowerCase());
      if (decoded === undefined) {
        throw new Error(`unsupported HTML entity ${entity}`);
      }
      return decoded;
    },
  );
}

export async function extractBulbapediaPlainText(
  html: string,
): Promise<string> {
  const output: string[] = [];
  let ignoredDepth = 0;
  const transformed = new HTMLRewriter()
    .on(
      "table, style, script, noscript, figure, .mw-editsection, sup.reference, .references, .navbox, .toc, .partycontainer",
      {
        element(element) {
          ignoredDepth += 1;
          element.onEndTag(() => {
            ignoredDepth -= 1;
          });
        },
      },
    )
    .on(".mw-parser-output", {
      text(chunk) {
        if (ignoredDepth === 0) {
          output.push(decodeHtmlEntities(chunk.text));
        }
      },
    })
    .on("h1, h2, p, blockquote", {
      element(element) {
        if (ignoredDepth > 0) return;
        element.onEndTag(() => {
          output.push("\n\n");
        });
      },
    })
    .on("h3, h4, h5, h6, li, dt, dd", {
      element(element) {
        if (ignoredDepth > 0) return;
        element.onEndTag(() => {
          output.push("\n");
        });
      },
    })
    .on("br", {
      element() {
        if (ignoredDepth === 0) {
          output.push("\n");
        }
      },
    })
    .transform(new Response(html));
  await transformed.arrayBuffer();
  const text = output
    .join("")
    .replaceAll("\u{A0}", " ")
    .replaceAll("\u{D}", "")
    .replaceAll(/[ \t\f\v]+/g, " ")
    .replaceAll(/ *\n */g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length === 0) {
    throw new Error(
      "Bulbapedia parse response omitted .mw-parser-output or produced no article text",
    );
  }
  return text;
}

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

export function buildBulbapediaRequestUrl(
  api: string,
  pin: BulbapediaPagePin,
): string {
  const url = new URL(api);
  url.search = new URLSearchParams({
    action: "parse",
    format: "json",
    formatversion: "2",
    oldid: String(pin.revision),
    prop: "text|revid",
    disablelimitreport: "1",
    disableeditsection: "1",
    disabletoc: "1",
  }).toString();
  return url.toString();
}

export function parsePinnedBulbapediaPage(
  raw: unknown,
  pin: BulbapediaPagePin,
): BulbapediaPage {
  const page = ParseResponseSchema.parse(raw).parse;
  if (page.revid !== pin.revision || page.title !== pin.title) {
    throw new Error(
      `Bulbapedia returned unexpected parsed revision for ${pin.title}`,
    );
  }
  return page;
}

export async function buildBulbapediaRecords(
  sources: Sources,
): Promise<KnowledgeRecord[]> {
  const records: KnowledgeRecord[] = [];

  for (const [index, pin] of sources.bulbapedia.pages.entries()) {
    if (index > 0) {
      await Bun.sleep(BULBAPEDIA_REQUEST_DELAY_MS);
    }
    const url = buildBulbapediaRequestUrl(sources.bulbapedia.api, pin);
    const page = parsePinnedBulbapediaPage(await fetchJson(url), pin);
    const chunks = chunkText(await extractBulbapediaPlainText(page.text));
    chunks.forEach((body, chunkIndex) => {
      const sequence = chunkIndex + 1;
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
        sources: [
          {
            id: "bulbapedia",
            url: `https://bulbapedia.bulbagarden.net/wiki/${encodeURI(pin.title.replaceAll(" ", "_"))}?oldid=${String(pin.revision)}`,
            license: sources.bulbapedia.license,
            revision: String(pin.revision),
          },
        ],
      });
    });
  }
  return records;
}
