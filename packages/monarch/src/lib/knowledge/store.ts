import path from "node:path";
import { homedir } from "node:os";
import { z } from "zod";
import type { MerchantKnowledge } from "./types.ts";
import { log } from "../logger.ts";

const KB_PATH = path.join(homedir(), ".monarch-cache", "merchant-kb.json");

const MerchantKnowledgeSchema = z.object({
  merchantName: z.string(),
  aliases: z.array(z.string()),
  merchantType: z.string(),
  description: z.string(),
  multiCategory: z.boolean(),
  defaultCategory: z
    .object({ id: z.string(), name: z.string() })
    .optional(),
  categoryHistory: z.array(
    z.object({ categoryName: z.string(), count: z.number() }),
  ),
  source: z.enum(["hint", "web_search", "learned", "history"]),
  confidence: z.enum(["high", "medium", "low"]),
  lastUpdated: z.string(),
});

const KBFileSchema = z.record(z.string(), MerchantKnowledgeSchema);

export async function loadKnowledgeBase(): Promise<
  Map<string, MerchantKnowledge>
> {
  const kb = new Map<string, MerchantKnowledge>();
  const file = Bun.file(KB_PATH);

  if (await file.exists()) {
    const raw: unknown = JSON.parse(await file.text());
    const parsed = KBFileSchema.parse(raw);
    for (const [key, value] of Object.entries(parsed)) {
      kb.set(key, value);
    }
    log.info(`Loaded ${String(kb.size)} merchant KB entries`);
  }

  return kb;
}

export async function saveKnowledgeBase(
  kb: Map<string, MerchantKnowledge>,
): Promise<void> {
  const obj: Record<string, MerchantKnowledge> = Object.fromEntries(kb);
  await Bun.write(KB_PATH, JSON.stringify(obj, null, 2));
  log.info(`Saved ${String(kb.size)} merchant KB entries`);
}

export function lookupMerchant(
  kb: Map<string, MerchantKnowledge>,
  merchantName: string,
): MerchantKnowledge | undefined {
  const lower = merchantName.toLowerCase();
  const direct = kb.get(lower);
  if (direct) return direct;

  // Check aliases
  for (const entry of kb.values()) {
    if (entry.aliases.some((a) => a.toLowerCase() === lower)) {
      return entry;
    }
  }

  return undefined;
}

export function addMerchantToKB(
  kb: Map<string, MerchantKnowledge>,
  entry: MerchantKnowledge,
): void {
  kb.set(entry.merchantName.toLowerCase(), entry);
}

type ParsedHint = {
  merchantNames: string[];
  description: string;
  categoryName: string;
};

function parseHintLine(content: string): ParsedHint | undefined {
  // Use separate, non-overlapping captures to avoid regex backtracking.
  // Split on dash/em-dash/en-dash separator first.
  const separatorIndex = content.search(/\s+[—–-]+\s*/);
  if (separatorIndex === -1) return undefined;

  const leftPart = content.slice(0, separatorIndex).trim();
  const rightPart = content.slice(separatorIndex).replace(/^[\s—–-]+/, "").trim();

  // Parse left side: "X is/are (a) Y"
  // Use indexOf to find the verb boundary instead of regex with overlapping quantifiers
  const leftLower = leftPart.toLowerCase();
  let verbIndex = leftLower.indexOf(" is ");
  let verbLen = 4;
  if (verbIndex === -1) {
    verbIndex = leftLower.indexOf(" are ");
    verbLen = 5;
  }
  if (verbIndex === -1) return undefined;

  const merchantPart = leftPart.slice(0, verbIndex).trim();
  let descriptionPart = leftPart.slice(verbIndex + verbLen).trim();
  // Strip optional "a " prefix
  if (descriptionPart.toLowerCase().startsWith("a ")) {
    descriptionPart = descriptionPart.slice(2).trim();
  }

  const merchantNames = merchantPart
    .split(/,\s*(?:and\s+)?/)
    .map((n) => n.trim())
    .filter((n) => n !== "");
  const description = descriptionPart;

  if (merchantNames.length === 0) return undefined;

  // Parse right side: optional "categorize as" / "use" / "always" prefix, strip trailing ", not ..." or ", never ..."
  let categoryName = rightPart;
  for (const prefix of ["categorize as ", "use ", "always "]) {
    if (categoryName.toLowerCase().startsWith(prefix)) {
      categoryName = categoryName.slice(prefix.length);
      break;
    }
  }
  // Strip trailing ", not ..." or ", never ..."
  const notIndex = categoryName.search(/,\s*(?:not|never)\s/i);
  if (notIndex !== -1) {
    categoryName = categoryName.slice(0, notIndex);
  }
  categoryName = categoryName.replace(/\.+$/, "").trim();

  if (categoryName === "") return undefined;

  return { merchantNames, description, categoryName };
}

export function parseHintsToKB(
  hints: string,
  categories: { id: string; name: string }[],
): MerchantKnowledge[] {
  const entries: MerchantKnowledge[] = [];
  const catMap = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

  for (const line of hints.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (!trimmed.startsWith("-")) continue;

    const content = trimmed.slice(1).trim();
    const parsed = parseHintLine(content);
    if (!parsed) continue;

    const cat = catMap.get(parsed.categoryName.toLowerCase());
    if (!cat) continue;

    const primaryName = parsed.merchantNames[0] ?? "";
    const aliases = parsed.merchantNames.slice(1);

    entries.push({
      merchantName: primaryName,
      aliases,
      merchantType: parsed.description,
      description: `${primaryName} is ${parsed.description}`,
      multiCategory: false,
      defaultCategory: { id: cat.id, name: cat.name },
      categoryHistory: [],
      source: "hint",
      confidence: "high",
      lastUpdated: new Date().toISOString(),
    });
  }

  return entries;
}

export function learnFromClassification(
  kb: Map<string, MerchantKnowledge>,
  merchantName: string,
  categoryName: string,
): void {
  const lower = merchantName.toLowerCase();
  const existing = kb.get(lower);

  if (existing) {
    const historyEntry = existing.categoryHistory.find(
      (h) => h.categoryName === categoryName,
    );
    if (historyEntry) {
      historyEntry.count += 1;
    } else {
      existing.categoryHistory.push({ categoryName, count: 1 });
    }
    existing.lastUpdated = new Date().toISOString();
  }
  // Don't auto-create KB entries from single classifications;
  // that's handled by the suggestion system
}
