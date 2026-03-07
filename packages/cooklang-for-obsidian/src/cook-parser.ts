/** Cooklang parser — chevrotain lexer + hand-written token-stream parser for
 *  robust handling of special characters in ingredient/cookware/timer names. */

import { createToken, Lexer, type IToken } from "chevrotain";

// ── Exported types (unchanged — renderer compatibility) ─────────────────────

export type Ingredient = {
  name: string;
  quantity: string;
  units: string;
};

export type Cookware = {
  name: string;
};

export type Timer = {
  name: string;
  quantity: string;
  units: string;
};

export type StepToken = {
  type: "text" | "ingredient" | "cookware" | "timer";
  value: string;
  ref?: Ingredient | Cookware | Timer;
};

export type Step = {
  tokens: StepToken[];
  raw: string;
};

export type Section = {
  name: string;
  steps: Step[];
};

export type RecipeMetadata = Record<string, string>;

export type ParsedRecipe = {
  metadata: RecipeMetadata;
  ingredients: Ingredient[];
  cookware: Cookware[];
  timers: Timer[];
  sections: Section[];
  hasCooklangMarkup: boolean;
};

// ── Chevrotain Lexer tokens ─────────────────────────────────────────────────
// Order matters: sigils before Punct so @ is always AtSign, not Punct.

const AtSign = createToken({ name: "AtSign", pattern: /@/ });
const HashSign = createToken({ name: "HashSign", pattern: /#/ });
const TildeSign = createToken({ name: "TildeSign", pattern: /~/ });
const LBrace = createToken({ name: "LBrace", pattern: /\{/ });
const RBrace = createToken({ name: "RBrace", pattern: /\}/ });
const Percent = createToken({ name: "Percent", pattern: /%/ });
// \w covers [a-zA-Z0-9_]; Unicode ranges cover Latin Extended, Cyrillic, Greek,
// Arabic, CJK, and Korean — enough for recipe names in most languages.
// Chevrotain doesn't support the `u` flag with \p{L}, so we enumerate ranges.
const UNICODE_LETTER_RANGES =
  "\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u0370-\u03FF\u3000-\u9FFF\uAC00-\uD7AF";
const Word = createToken({
  name: "Word",
  pattern: new RegExp(String.raw`[\w${UNICODE_LETTER_RANGES}-]+`),
});
const Space = createToken({ name: "Space", pattern: / +/ });
const Punct = createToken({
  name: "Punct",
  pattern: new RegExp(String.raw`[^\w${UNICODE_LETTER_RANGES} @#~{}%\n-]`),
});

const allTokens = [
  AtSign,
  HashSign,
  TildeSign,
  LBrace,
  RBrace,
  Percent,
  Word,
  Space,
  Punct,
];
const stepLexer = new Lexer(allTokens, {
  lineTerminatorCharacters: ["\n"],
  // We tokenize single lines, so line tracking isn't needed
  positionTracking: "onlyOffset",
});

// ── Token-stream parser ─────────────────────────────────────────────────────
// Simple hand-written recursive descent over the token array. This avoids
// chevrotain's CstParser ambiguity issues while still benefiting from its lexer.

/** Find the index of the next LBrace before any sigil boundary. Returns -1 if none.
 *  `~` is only treated as a boundary when preceded by a space (i.e. a standalone timer),
 *  not when it immediately follows a sigil like `@~454g` ("approximately 454g"). */
function findBraceBeforeSigil(tokens: IToken[], from: number): number {
  for (let i = from; i < tokens.length; i++) {
    if (tokens[i].tokenType === LBrace) return i;
    if (tokens[i].tokenType === AtSign || tokens[i].tokenType === HashSign)
      return -1;
    // ~ after a space is a timer boundary; ~ without preceding space is part of name
    if (
      tokens[i].tokenType === TildeSign &&
      i > from &&
      tokens[i - 1].tokenType === Space
    )
      return -1;
  }
  return -1;
}

/** Find matching RBrace starting after LBrace at `from`. Returns -1 if none. */
function findMatchingRBrace(tokens: IToken[], from: number): number {
  for (let i = from; i < tokens.length; i++) {
    if (tokens[i].tokenType === RBrace) return i;
  }
  return -1;
}

/** Collect image text from tokens[start..end) */
function collectImages(tokens: IToken[], start: number, end: number): string {
  let s = "";
  for (let i = start; i < end; i++) {
    s += tokens[i].image;
  }
  return s;
}

/** Parse the brace body (between { and }) into quantity + units. */
function parseQuantityBody(
  tokens: IToken[],
  start: number,
  end: number,
): { quantity: string; units: string } {
  // Find % separator
  let percentIdx = -1;
  for (let i = start; i < end; i++) {
    if (tokens[i].tokenType === Percent) {
      percentIdx = i;
      break;
    }
  }

  if (percentIdx !== -1) {
    const quantity = collectImages(tokens, start, percentIdx).trim();
    const units = collectImages(tokens, percentIdx + 1, end).trim();
    return { quantity, units };
  }

  // No percent — everything is quantity
  const quantity = collectImages(tokens, start, end).trim();
  return { quantity, units: "" };
}

/** Parse a step line's token array into StepTokens. */
function parseTokenStream(
  tokens: IToken[],
  ingredients: Ingredient[],
  cookware: Cookware[],
  timers: Timer[],
): StepToken[] {
  const result: StepToken[] = [];
  let pos = 0;
  let textBuf = "";

  const flush = () => {
    if (textBuf) {
      result.push({ type: "text", value: textBuf });
      textBuf = "";
    }
  };

  while (pos < tokens.length) {
    const tok = tokens[pos];

    // ── @ingredient ─────────────────────────────────────────────────
    if (tok.tokenType === AtSign) {
      // Look ahead: is there a { before the next sigil?
      const braceIdx = findBraceBeforeSigil(tokens, pos + 1);
      if (braceIdx !== -1) {
        const rbraceIdx = findMatchingRBrace(tokens, braceIdx + 1);
        if (rbraceIdx !== -1) {
          // Braced form: @name{qty%unit}
          flush();
          const name = collectImages(tokens, pos + 1, braceIdx).trim();
          const { quantity, units } = parseQuantityBody(
            tokens,
            braceIdx + 1,
            rbraceIdx,
          );
          const ingredient: Ingredient = { name, quantity, units };
          ingredients.push(ingredient);
          result.push({ type: "ingredient", value: name, ref: ingredient });
          pos = rbraceIdx + 1;
          continue;
        }
      }

      // Bare form: @word (single word after @)
      if (pos + 1 < tokens.length && tokens[pos + 1].tokenType === Word) {
        flush();
        const name = tokens[pos + 1].image;
        const ingredient: Ingredient = { name, quantity: "", units: "" };
        ingredients.push(ingredient);
        result.push({ type: "ingredient", value: name, ref: ingredient });
        pos += 2;
        continue;
      }

      // Not a valid ingredient marker — treat @ as text
      textBuf += tok.image;
      pos++;
      continue;
    }

    // ── #cookware ────────────────────────────────────────────────────
    if (tok.tokenType === HashSign) {
      const braceIdx = findBraceBeforeSigil(tokens, pos + 1);
      if (braceIdx !== -1) {
        const rbraceIdx = findMatchingRBrace(tokens, braceIdx + 1);
        if (rbraceIdx !== -1) {
          flush();
          const name = collectImages(tokens, pos + 1, braceIdx).trim();
          const cw: Cookware = { name };
          cookware.push(cw);
          result.push({ type: "cookware", value: name, ref: cw });
          pos = rbraceIdx + 1;
          continue;
        }
      }

      // Bare form: #word
      if (pos + 1 < tokens.length && tokens[pos + 1].tokenType === Word) {
        flush();
        const name = tokens[pos + 1].image;
        const cw: Cookware = { name };
        cookware.push(cw);
        result.push({ type: "cookware", value: name, ref: cw });
        pos += 2;
        continue;
      }

      textBuf += tok.image;
      pos++;
      continue;
    }

    // ── ~timer ──────────────────────────────────────────────────────
    if (tok.tokenType === TildeSign) {
      const braceIdx = findBraceBeforeSigil(tokens, pos + 1);
      if (braceIdx !== -1) {
        const rbraceIdx = findMatchingRBrace(tokens, braceIdx + 1);
        if (rbraceIdx !== -1) {
          flush();
          const name = collectImages(tokens, pos + 1, braceIdx).trim();
          const { quantity, units } = parseQuantityBody(
            tokens,
            braceIdx + 1,
            rbraceIdx,
          );
          const timer: Timer = { name, quantity, units };
          timers.push(timer);
          result.push({
            type: "timer",
            value: quantity + (units ? " " + units : ""),
            ref: timer,
          });
          pos = rbraceIdx + 1;
          continue;
        }
      }

      // No valid timer brace — treat ~ as text
      textBuf += tok.image;
      pos++;
      continue;
    }

    // ── Plain text ──────────────────────────────────────────────────
    textBuf += tok.image;
    pos++;
  }

  flush();
  return result;
}

// ── Tokenize a step line ────────────────────────────────────────────────────

function tokenizeCooklangLine(
  line: string,
  ingredients: Ingredient[],
  cookware: Cookware[],
  timers: Timer[],
): StepToken[] {
  const lexResult = stepLexer.tokenize(line);
  if (lexResult.errors.length > 0) {
    return [{ type: "text", value: line }];
  }

  return parseTokenStream(lexResult.tokens, ingredients, cookware, timers);
}

// ── Line-level preprocessing (hand-written, unchanged) ──────────────────────

/** Parse YAML frontmatter from a .cook file. Returns metadata + remaining body. */
function parseFrontmatter(text: string): {
  metadata: RecipeMetadata;
  body: string;
} {
  const metadata: RecipeMetadata = {};
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("---")) {
    return { metadata, body: text };
  }

  const endIndex = trimmed.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { metadata, body: text };
  }

  const frontmatterBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 4).trim();

  let currentKey = "";
  let currentValue = "";
  let inMultiline = false;

  for (const line of frontmatterBlock.split("\n")) {
    if (inMultiline) {
      if (line.startsWith("  ") || line.trim() === "") {
        currentValue += (currentValue ? "\n" : "") + line.replace(/^ {2}/, "");
        continue;
      } else {
        metadata[currentKey] = currentValue.trim();
        inMultiline = false;
      }
    }

    const match = /^([\w.-]+):\s*(.*)/.exec(line);
    if (match) {
      currentKey = match[1];
      const val = match[2];
      if (val === "|" || val === ">") {
        inMultiline = true;
        currentValue = "";
      } else {
        metadata[currentKey] = val.trim();
      }
    }
  }

  if (inMultiline && currentKey) {
    metadata[currentKey] = currentValue.trim();
  }

  return { metadata, body };
}

/** Try to parse a section header line like "== Section Name ==" or "= Name".
 *  Returns the section name, or null if the line is not a section header. */
function parseSectionHeader(line: string): string | null {
  if (!line.startsWith("=")) return null;
  // Strip leading '=' characters
  let start = 0;
  while (start < line.length && line[start] === "=") start++;
  // Strip trailing '=' characters
  let end = line.length;
  while (end > start && line[end - 1] === "=") end--;
  const name = line.slice(start, end).trim();
  return name || null;
}

/** Check if the body contains Cooklang markup (@, #, ~). */
function hasCooklangSyntax(body: string): boolean {
  return /@\w|#\w|~[\w{]/.test(body);
}

/** Parse a recipe with Cooklang markup. */
function parseCooklangBody(
  body: string,
): Omit<ParsedRecipe, "metadata" | "hasCooklangMarkup"> {
  const ingredients: Ingredient[] = [];
  const cookware: Cookware[] = [];
  const timers: Timer[] = [];
  const sections: Section[] = [];
  let currentSection: Section = { name: "", steps: [] };

  for (const line of body.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) continue;
    if (trimmed.startsWith("--")) continue;
    if (trimmed.startsWith("[-")) continue;

    const sectionName = parseSectionHeader(trimmed);
    if (sectionName != null) {
      if (currentSection.name !== "" || currentSection.steps.length > 0) {
        sections.push(currentSection);
      }
      currentSection = { name: sectionName, steps: [] };
      continue;
    }

    const tokens = tokenizeCooklangLine(trimmed, ingredients, cookware, timers);
    currentSection.steps.push({ tokens, raw: trimmed });
  }

  if (currentSection.name !== "" || currentSection.steps.length > 0) {
    sections.push(currentSection);
  }

  return { ingredients, cookware, timers, sections };
}

/** Parse a plain-text recipe (no Cooklang markup). */
function parsePlainTextBody(
  body: string,
): Omit<ParsedRecipe, "metadata" | "hasCooklangMarkup"> {
  const ingredients: Ingredient[] = [];
  const cookware: Cookware[] = [];
  const timers: Timer[] = [];
  const sections: Section[] = [];
  let currentSection: Section = { name: "", steps: [] };

  for (const line of body.split("\n")) {
    const trimmed = line.trim();

    if (!trimmed) continue;

    const sectionName = parseSectionHeader(trimmed);
    if (sectionName != null) {
      if (currentSection.name !== "" || currentSection.steps.length > 0) {
        sections.push(currentSection);
      }
      currentSection = { name: sectionName, steps: [] };
      continue;
    }

    if (/ingredients/i.test(currentSection.name)) {
      if (
        (trimmed.endsWith(":") ||
          (trimmed === trimmed.charAt(0).toUpperCase() + trimmed.slice(1) &&
            !/^\d/.test(trimmed) &&
            trimmed.split(" ").length <= 4 &&
            !trimmed.includes(","))) &&
        trimmed.endsWith(":")
      ) {
        currentSection.steps.push({
          tokens: [{ type: "text", value: trimmed }],
          raw: trimmed,
        });
        continue;
      }

      const ingMatch =
        /^([\d½¼¾⅓⅔⅛⅜⅝⅞/\s.-]+)?((?:ounces?|oz|pounds?|lbs?|cups?|tablespoons?|tbsp|teaspoons?|tsp|cloves?|medium|large|small|pieces?|slices?|cans?|grams?|g|ml|liters?|pinch(?:es)?|heads?|bunche?s?|stalks?|sprigs?|inches?|dashes?)[.)]*\s+)?(.+)/i.exec(
          trimmed,
        );
      if (ingMatch) {
        const qty = (ingMatch[1] || "").trim();
        const unit = (ingMatch[2] || "").trim();
        const name = (ingMatch[3] || trimmed).trim();
        const ingredient: Ingredient = { name, quantity: qty, units: unit };
        ingredients.push(ingredient);
        currentSection.steps.push({
          tokens: [{ type: "ingredient", value: trimmed, ref: ingredient }],
          raw: trimmed,
        });
      } else {
        const ingredient: Ingredient = {
          name: trimmed,
          quantity: "",
          units: "",
        };
        ingredients.push(ingredient);
        currentSection.steps.push({
          tokens: [{ type: "ingredient", value: trimmed, ref: ingredient }],
          raw: trimmed,
        });
      }
      continue;
    }

    currentSection.steps.push({
      tokens: [{ type: "text", value: trimmed }],
      raw: trimmed,
    });
  }

  if (currentSection.name !== "" || currentSection.steps.length > 0) {
    sections.push(currentSection);
  }

  return { ingredients, cookware, timers, sections };
}

/** Parse a .cook file into structured recipe data. */
export function parseRecipe(text: string): ParsedRecipe {
  const { metadata, body } = parseFrontmatter(text);
  const isCooklang = hasCooklangSyntax(body);

  const parsed = isCooklang
    ? parseCooklangBody(body)
    : parsePlainTextBody(body);

  return {
    metadata,
    ...parsed,
    hasCooklangMarkup: isCooklang,
  };
}
