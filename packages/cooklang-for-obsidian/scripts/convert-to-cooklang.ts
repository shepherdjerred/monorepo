#!/usr/bin/env bun
/**
 * Convert plain-text recipes to Cooklang markup format.
 * Converts the = Ingredients section to use @ingredient{qty%unit} syntax.
 * Keeps directions as plain text (they render well without annotation).
 */

import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RECIPE_DIR = "/Users/jerred/Documents/Obsidian/Main Vault/Recipes";

interface ParsedIngredient {
  raw: string;
  quantity: string;
  unit: string;
  name: string;
  extra: string; // modifiers like "thinly sliced", "diced"
  isSubheader: boolean;
}

const UNIT_PATTERN =
  /^(ounces?|oz|pounds?|lbs?|cups?|tablespoons?|tbsp|teaspoons?|tsp|cloves?|medium|large|small|pieces?|slices?|cans?|grams?|g|ml|liters?|l|pinch(?:es)?|heads?|bunche?s?|stalks?|sprigs?|inches?|inch|dashes?|sticks?|whole|drops?|quarts?|pints?|gallons?|bags?|packages?|jars?|bottles?|bundles?|sheets?|leaves|strips?|envelopes?|packets?)\b/i;

function parseIngredientLine(line: string): ParsedIngredient {
  const trimmed = line.trim();

  // Sub-headers: lines ending with ":"
  if (trimmed.endsWith(":")) {
    return { raw: trimmed, quantity: "", unit: "", name: trimmed, extra: "", isSubheader: true };
  }

  // Short capitalized labels without numbers are sub-headers (e.g., "Dough", "Sauce", "Toppings")
  // Known sub-header patterns from the recipes
  const SUB_HEADER_PATTERNS = [
    /^(Dough|Sauce|Toppings|Filling|Glaze|Frosting|Marinade|Garnish|Coating|Batter|Topping|Crust|Assembly)$/i,
    /^Gather Your Ingredients$/i,
    /^Seasoned\s+\w+\s+\w+$/i,
    /^Remaining\s+\w+\s+\w+$/i,
  ];
  if (SUB_HEADER_PATTERNS.some((p) => p.test(trimmed))) {
    return { raw: trimmed, quantity: "", unit: "", name: trimmed, extra: "", isSubheader: true };
  }

  // Match quantity at start: numbers, fractions, Unicode fractions, ranges
  const qtyMatch = trimmed.match(
    /^([\d½¼¾⅓⅔⅛⅜⅝⅞]+(?:\s*[\d/½¼¾⅓⅔⅛⅜⅝⅞]+)*(?:\s*(?:to|-)\s*[\d½¼¾⅓⅔⅛⅜⅝⅞]+(?:\s*[\d/½¼¾⅓⅔⅛⅜⅝⅞]+)*)?)\s+/,
  );

  if (!qtyMatch) {
    // No quantity — just ingredient name
    const { name, extra } = splitNameExtra(trimmed);
    return { raw: trimmed, quantity: "", unit: "", name, extra, isSubheader: false };
  }

  const quantity = qtyMatch[1].trim();
  let rest = trimmed.slice(qtyMatch[0].length);

  // Match unit first (before checking for parenthetical metric)
  const unitMatch = rest.match(UNIT_PATTERN);
  let unit = "";
  if (unitMatch) {
    unit = unitMatch[1];
    rest = rest.slice(unitMatch[0].length).trim();

    // Skip parenthetical metric equivalent after unit: "cup (60ml)" or "(450g)"
    const parenMatch = rest.match(/^\([^)]+\)\s*/);
    if (parenMatch) {
      rest = rest.slice(parenMatch[0].length);
    }

    // Skip "of" after unit
    if (rest.startsWith("of ")) {
      rest = rest.slice(3);
    }
  } else {
    // No unit found — check if parenthetical metric is at start: "(450g) ingredient"
    const parenMatch = rest.match(/^\([^)]+\)\s*/);
    if (parenMatch) {
      rest = rest.slice(parenMatch[0].length);
      // Try matching unit again after skipping paren
      const unitMatch2 = rest.match(UNIT_PATTERN);
      if (unitMatch2) {
        unit = unitMatch2[1];
        rest = rest.slice(unitMatch2[0].length).trim();
      }
    }
  }

  const { name, extra } = splitNameExtra(rest);
  return { raw: trimmed, quantity, unit, name, extra, isSubheader: false };
}

function splitNameExtra(text: string): { name: string; extra: string } {
  // Split on comma for modifiers: "garlic, thinly sliced" -> name: "garlic", extra: "thinly sliced"
  const commaIdx = text.indexOf(",");
  if (commaIdx !== -1) {
    return { name: text.slice(0, commaIdx).trim(), extra: text.slice(commaIdx + 1).trim() };
  }

  // Split on semicolon
  const semiIdx = text.indexOf(";");
  if (semiIdx !== -1) {
    return { name: text.slice(0, semiIdx).trim(), extra: text.slice(semiIdx + 1).trim() };
  }

  // Split on parenthetical at end: "olive oil (about 2 cups)" -> name: "olive oil", extra: "about 2 cups"
  const parenMatch = text.match(/^(.+?)\s*\((.+)\)\s*$/);
  if (parenMatch) {
    return { name: parenMatch[1].trim(), extra: parenMatch[2].trim() };
  }

  return { name: text.trim(), extra: "" };
}

function toCooklangIngredient(parsed: ParsedIngredient): string {
  if (parsed.isSubheader) {
    return parsed.raw;
  }

  const name = parsed.name;
  let qtyPart = "";
  if (parsed.quantity && parsed.unit) {
    qtyPart = `${parsed.quantity}%${parsed.unit}`;
  } else if (parsed.quantity) {
    qtyPart = parsed.quantity;
  }

  let result = `@${name}{${qtyPart}}`;
  if (parsed.extra) {
    result += `, ${parsed.extra}`;
  }
  return result;
}

async function convertFile(
  filePath: string,
  dryRun: boolean,
): Promise<{ name: string; changed: boolean; preview?: string }> {
  const content = await readFile(filePath, "utf-8");
  const fileName = filePath.split("/").pop() ?? filePath;

  // Check if already has Cooklang markup
  if (/@[\w].*\{/.test(content.replace(/^---[\s\S]*?---/, ""))) {
    return { name: fileName, changed: false };
  }

  // Split frontmatter and body
  const fmMatch = content.match(/^(---[\s\S]*?---\n?)([\s\S]*)$/);
  if (!fmMatch) {
    return { name: fileName, changed: false };
  }

  const frontmatter = fmMatch[1];
  const body = fmMatch[2];

  // Split body into sections
  const lines = body.split("\n");
  const output: string[] = [];
  const changes: string[] = [];
  let inIngredients = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Section header
    const sectionMatch = trimmed.match(/^=\s*(.+?)\s*$/);
    if (sectionMatch) {
      const sectionName = sectionMatch[1];
      inIngredients = /ingredients/i.test(sectionName);
      output.push(line);
      continue;
    }

    if (inIngredients && trimmed) {
      const parsed = parseIngredientLine(trimmed);
      const converted = toCooklangIngredient(parsed);
      output.push(converted);
      if (converted !== trimmed) {
        changes.push(`  "${trimmed}" => "${converted}"`);
      }
    } else {
      output.push(line);
    }
  }

  if (changes.length === 0) {
    return { name: fileName, changed: false };
  }

  const newContent = frontmatter + output.join("\n");
  if (!dryRun) {
    await writeFile(filePath, newContent, "utf-8");
  }
  return { name: fileName, changed: true, preview: changes.join("\n") };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const entries = await readdir(RECIPE_DIR);
  const cookFiles = entries.filter((e) => e.endsWith(".cook"));

  console.log(`Found ${cookFiles.length} .cook files${dryRun ? " (DRY RUN)" : ""}`);

  let converted = 0;
  for (const file of cookFiles) {
    const result = await convertFile(join(RECIPE_DIR, file), dryRun);
    if (result.changed) {
      converted++;
      console.log(`\n  Converted: ${result.name}`);
      if (result.preview) {
        console.log(result.preview);
      }
    }
  }

  console.log(`\nDone: ${converted}/${cookFiles.length} files would be converted`);
  if (dryRun && converted > 0) {
    console.log("Run without --dry-run to apply changes.");
  }
}

main().catch(console.error);
