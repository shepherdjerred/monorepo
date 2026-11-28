// Deterministic reader for Riot's official patch-notes pages (the raw HTML kept
// in `patch-notes-archive/`). It walks the champions and items sections with a
// streaming `HTMLRewriter` state machine and returns one raw change per line of
// the form `<strong>Stat</strong>: before ⇒ <strong>after</strong>`.
//
// Markup the archive actually uses:
//   h2#patch-champions / h2#patch-items      section start (any other h2 ends it)
//   div.patch-change-block                   one subject's block
//   h3.change-title                          champion or item name
//   h4.change-detail-title                   "W - Infernal Chains", "Base Stats",
//                                            an unprefixed ability name
//                                            ("Calibrum"), an item passive, or
//                                            (items, no h3) the item itself
//   li / p (outside blockquote)              the change lines
//
// Lines without "⇒" (bugfix notes, new-ability descriptions) and "⇒ Unchanged"
// are not before/after changes; they are reported in `skipped`, never dropped
// silently. Resolving names to ids and deriving directions happen elsewhere.

import { z } from "zod";

export type PatchSubjectKind = "champion" | "item";

export type RawAbility = {
  /** "passive", "Q", "W", "E", "R", or a mimic slot like "RW"; null when the heading names no slot. */
  slot: string | null;
  name: string;
};

export type RawPatchChange = {
  kind: PatchSubjectKind;
  subject: string;
  ability: RawAbility | null;
  stat: string;
  before: string;
  after: string;
};

export type SkippedLine = {
  kind: PatchSubjectKind;
  subject: string | null;
  text: string;
};

export type ParsedPatchNotes = {
  /** Player-facing patch number, e.g. "26.19". */
  patch: string;
  /** Publish date, `YYYY-MM-DD`. */
  date: string;
  /** Every champion and item block seen, in page order, with or without lines. */
  subjects: { kind: PatchSubjectKind; name: string }[];
  changes: RawPatchChange[];
  skipped: SkippedLine[];
};

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** HTMLRewriter hands text over undecoded; unknown entities fail loudly. */
export function decodeEntities(text: string): string {
  return text.replaceAll(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    const entity = String(body);
    if (entity.startsWith("#x") || entity.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    }
    if (entity.startsWith("#")) {
      return String.fromCodePoint(Number(entity.slice(1)));
    }
    const named = NAMED_ENTITIES[entity.toLowerCase()];
    if (named === undefined) {
      throw new Error(`Unhandled HTML entity ${match} in patch notes`);
    }
    return named;
  });
}

function clean(text: string): string {
  return decodeEntities(text).replaceAll(/\s+/g, " ").trim();
}

const NextDataSchema = z.object({
  props: z.object({
    pageProps: z.object({
      page: z.object({
        title: z.string(),
        displayedPublishDate: z.string(),
      }),
    }),
  }),
});

function readPageMeta(nextData: string): { patch: string; date: string } {
  const page = NextDataSchema.parse(JSON.parse(nextData)).props.pageProps.page;
  const patch = /Patch (\d+\.\d+) Notes/.exec(page.title)?.[1];
  const date = /^(\d{4}-\d{2}-\d{2})T/.exec(page.displayedPublishDate)?.[1];
  if (patch === undefined || date === undefined) {
    throw new Error(
      `Patch notes page has an unreadable title or date: ${page.title} / ${page.displayedPublishDate}`,
    );
  }
  return { patch, date };
}

const ABILITY_HEADING = /^(Passive|[QWER]{1,2}) - (.+)$/;

function parseAbility(
  kind: PatchSubjectKind,
  heading: string,
  isAbilityTitle: boolean,
): RawAbility | null {
  if (heading === "" || heading === "Base Stats") {
    return null;
  }
  const match = ABILITY_HEADING.exec(heading);
  if (match?.[1] !== undefined && match[2] !== undefined) {
    return {
      slot: match[1] === "Passive" ? "passive" : match[1],
      name: match[2],
    };
  }
  // Aphelios' weapons carry only a name; an item's passive heading likewise.
  if (kind === "item" || isAbilityTitle) {
    return { slot: null, name: heading };
  }
  throw new Error(`Unrecognised champion detail heading: "${heading}"`);
}

type Part = { text: string; strong: boolean };

function isBlank(text: string): boolean {
  return clean(text) === "";
}

/** The leading `<strong>` run of a line: the stat label. */
function readStat(parts: readonly Part[]): string | undefined {
  const firstStrong = parts.findIndex(
    (part) => part.strong && !isBlank(part.text),
  );
  if (firstStrong === -1) {
    return undefined;
  }
  if (!parts.slice(0, firstStrong).every((part) => isBlank(part.text))) {
    return undefined;
  }
  let stat = "";
  for (const part of parts.slice(firstStrong)) {
    if (!part.strong) break;
    stat += part.text;
  }
  return clean(stat);
}

type ChangeLine =
  | { type: "change"; stat: string; before: string; after: string }
  | { type: "skipped"; text: string };

const ARROW = "⇒";

function parseLine(parts: readonly Part[]): ChangeLine {
  const text = clean(parts.map((part) => part.text).join(""));
  const stat = readStat(parts);
  const arrows = text.split(ARROW).length - 1;
  if (arrows === 0 || stat === undefined) {
    return { type: "skipped", text };
  }
  if (arrows > 1) {
    throw new Error(`Patch note line has more than one ${ARROW}: ${text}`);
  }
  const [head = "", after = ""] = text.split(ARROW);
  const label = `${stat}:`;
  if (!head.startsWith(label)) {
    throw new Error(`Patch note line does not start with "${label}": ${text}`);
  }
  const before = head.slice(label.length).trim();
  const afterText = after.trim();
  if (afterText === "Unchanged") {
    return { type: "skipped", text };
  }
  if (before === "" || afterText === "") {
    throw new Error(`Patch note line has an empty side: ${text}`);
  }
  return { type: "change", stat, before, after: afterText };
}

type Heading = { tag: "h3" | "h4"; text: string; abilityTitle: boolean };
type Section = "champions" | "items";

export async function parsePatchNotes(html: string): Promise<ParsedPatchNotes> {
  let nextData = "";
  let section: Section | null = null;
  let blockTitle: string | null = null;
  let hasH3 = false;
  let ability: RawAbility | null = null;
  let heading: Heading | undefined;
  let line: Part[] | undefined;
  let openLine: readonly Part[] | undefined;
  let strongDepth = 0;
  let quoteDepth = 0;
  const subjects: ParsedPatchNotes["subjects"] = [];
  const changes: RawPatchChange[] = [];
  const skipped: SkippedLine[] = [];

  const kindOf = (current: Section): PatchSubjectKind =>
    current === "champions" ? "champion" : "item";

  function startSubject(current: Section, name: string): void {
    blockTitle = name;
    ability = null;
    subjects.push({ kind: kindOf(current), name });
  }

  function finishHeading(done: Heading): void {
    if (section === null) return;
    const text = clean(done.text);
    if (done.tag === "h3") {
      hasH3 = true;
      startSubject(section, text);
      return;
    }
    // An item block without an h3 is headed by its h4 (the item itself).
    if (section === "items" && !hasH3) {
      startSubject(section, text);
      return;
    }
    openLine = undefined;
    ability = parseAbility(kindOf(section), text, done.abilityTitle);
  }

  function finishLine(parts: readonly Part[]): void {
    if (section === null) return;
    const kind = kindOf(section);
    let current = parts;
    // The source occasionally splits one change over two list items:
    // "Cooldown: 10 / 9" then "⇒ 8 / 7". Rejoin them.
    if (
      openLine !== undefined &&
      clean(parts.map((part) => part.text).join("")).startsWith(ARROW)
    ) {
      current = [...openLine, ...parts];
      skipped.pop();
    }
    openLine = undefined;
    const parsed = parseLine(current);
    if (parsed.type === "skipped") {
      // Image-only paragraphs (champion portraits) carry no text.
      if (parsed.text === "") return;
      skipped.push({ kind, subject: blockTitle, text: parsed.text });
      openLine = current;
      return;
    }
    if (blockTitle === null) {
      throw new Error(`Patch note change outside any subject: ${parsed.stat}`);
    }
    changes.push({
      kind,
      subject: blockTitle,
      ability,
      stat: parsed.stat,
      before: parsed.before,
      after: parsed.after,
    });
  }

  const beginLine = (): void => {
    if (section !== null && quoteDepth === 0 && line === undefined) {
      line = [];
    }
  };
  const endLine = (): void => {
    if (line !== undefined) {
      finishLine(line);
      line = undefined;
    }
  };

  const rewriter = new HTMLRewriter()
    .on("script#__NEXT_DATA__", {
      text(chunk) {
        nextData += chunk.text;
      },
    })
    .on("h2", {
      element(element) {
        const id = element.getAttribute("id");
        if (id === "patch-champions") section = "champions";
        else if (id === "patch-items") section = "items";
        else section = null;
        blockTitle = null;
        ability = null;
      },
    })
    .on("div.patch-change-block", {
      element() {
        blockTitle = null;
        hasH3 = false;
        ability = null;
      },
    })
    .on("h3.change-title, h4.change-detail-title", {
      element(element) {
        const current: Heading = {
          tag: element.tagName === "h3" ? "h3" : "h4",
          text: "",
          abilityTitle: (element.getAttribute("class") ?? "").includes(
            "ability-title",
          ),
        };
        heading = current;
        element.onEndTag(() => {
          heading = undefined;
          finishHeading(current);
        });
      },
      text(chunk) {
        if (heading !== undefined) heading.text += chunk.text;
      },
    })
    .on("blockquote", {
      element(element) {
        quoteDepth += 1;
        element.onEndTag(() => {
          quoteDepth -= 1;
        });
      },
    })
    .on("li, p", {
      element(element) {
        const owned =
          section !== null && quoteDepth === 0 && line === undefined;
        beginLine();
        if (owned) element.onEndTag(endLine);
      },
      text(chunk) {
        line?.push({ text: chunk.text, strong: strongDepth > 0 });
      },
    })
    .on("li strong, p strong", {
      element(element) {
        strongDepth += 1;
        element.onEndTag(() => {
          strongDepth -= 1;
        });
      },
    });

  await rewriter.transform(new Response(html)).arrayBuffer();

  return { ...readPageMeta(nextData), subjects, changes, skipped };
}
