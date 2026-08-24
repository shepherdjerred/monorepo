import { z } from "zod";
import type {
  ScoutQlRenderListItemAst,
  ScoutQlRenderOptionAst,
  ScoutQlRenderValueAst,
} from "#src/model/scoutql/ast.ts";
import type { ScoutQlDiagnostic } from "#src/model/scoutql/diagnostics.ts";
import { emitDiagnostic } from "#src/model/scoutql/analyze-expr-shared.ts";

// ── RENDER option value readers ──────────────────────────────────────────────
// Each reader answers `undefined` after emitting exactly one spanned
// `render-option-invalid`, so a mistyped option produces one message pointing
// at the offending value rather than a cascade or a silent default.

export type OptionReader = {
  option: ScoutQlRenderOptionAst;
  diagnostics: ScoutQlDiagnostic[];
};

function reportInvalid(reader: OptionReader, expected: string): void {
  emitDiagnostic(reader.diagnostics, {
    code: "render-option-invalid",
    message: `RENDER ${reader.option.name} expects ${expected}.`,
    span: reader.option.value.span,
  });
}

export function readString(reader: OptionReader): string | undefined {
  const { value } = reader.option;
  if (value.kind === "string" && value.value.length > 0) {
    return value.value;
  }
  reportInvalid(reader, "a quoted string, e.g. 'Weekly games'");
  return undefined;
}

export function readBoolean(reader: OptionReader): boolean | undefined {
  const { value } = reader.option;
  if (value.kind === "boolean") {
    return value.value;
  }
  reportInvalid(reader, "true or false");
  return undefined;
}

export function readInteger(
  reader: OptionReader,
  bounds: { min: number; max: number },
): number | undefined {
  const { value } = reader.option;
  if (
    value.kind !== "number" ||
    !Number.isInteger(value.value) ||
    value.value < bounds.min ||
    value.value > bounds.max
  ) {
    reportInvalid(
      reader,
      `a whole number from ${String(bounds.min)} to ${String(bounds.max)}`,
    );
    return undefined;
  }
  return value.value;
}

/** An enum-valued option, written bare (`palette = gold`) or quoted. */
export function readEnum<T extends string>(
  reader: OptionReader,
  schema: z.ZodType<T>,
  choices: readonly string[],
): T | undefined {
  const { value } = reader.option;
  const raw =
    value.kind === "identifier"
      ? value.name
      : value.kind === "string"
        ? value.value
        : undefined;
  if (raw === undefined) {
    reportInvalid(reader, `one of ${choices.join(", ")}`);
    return undefined;
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) {
    return parsed.data;
  }
  reportInvalid(reader, `one of ${choices.join(", ")}`);
  return undefined;
}

type ListMember = ScoutQlRenderValueAst | ScoutQlRenderListItemAst;

function listItems(value: ScoutQlRenderValueAst): ListMember[] {
  return value.kind === "list" ? value.items : [value];
}

/** `y = win_rate` or `y = (wins, losses)` — a list of names. */
export function readNameList(reader: OptionReader): string[] | undefined {
  const names: string[] = [];
  for (const item of listItems(reader.option.value)) {
    if (item.kind === "identifier") {
      names.push(item.name);
      continue;
    }
    if (item.kind === "string") {
      names.push(item.value);
      continue;
    }
    reportInvalid(reader, "an output name, or a list like (wins, losses)");
    return undefined;
  }
  if (names.length === 0) {
    reportInvalid(reader, "at least one output name");
    return undefined;
  }
  return names;
}

export function readSingleName(reader: OptionReader): string | undefined {
  const names = readNameList(reader);
  if (names === undefined) {
    return undefined;
  }
  const [only] = names;
  if (only !== undefined && names.length === 1) {
    return only;
  }
  reportInvalid(reader, "exactly one output or grouping name");
  return undefined;
}

const HexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/iu);

export function readHexColors(reader: OptionReader): string[] | undefined {
  const colors: string[] = [];
  for (const item of listItems(reader.option.value)) {
    const raw = item.kind === "hex-color" ? item.value : undefined;
    if (raw === undefined || !HexColorSchema.safeParse(raw).success) {
      reportInvalid(reader, "a list of hex colours, e.g. (#5b8ff9, #f6bd16)");
      return undefined;
    }
    colors.push(raw.toLowerCase());
  }
  if (colors.length === 0 || colors.length > 8) {
    reportInvalid(reader, "between one and eight hex colours");
    return undefined;
  }
  return colors;
}

export type OptionPair = {
  name: string;
  value: string;
  span: { start: number; end: number };
};

/** `format = (win_rate = percent, games = count)`. */
export function readPairs(reader: OptionReader): OptionPair[] | undefined {
  const { value } = reader.option;
  if (value.kind !== "list") {
    reportInvalid(reader, "a list of assignments, e.g. (win_rate = percent)");
    return undefined;
  }
  const pairs: OptionPair[] = [];
  for (const item of value.items) {
    if (item.kind !== "pair") {
      reportInvalid(reader, "a list of assignments, e.g. (win_rate = percent)");
      return undefined;
    }
    const raw =
      item.value.kind === "identifier" ? item.value.name : item.value.value;
    pairs.push({ name: item.name, value: raw, span: item.span });
  }
  if (pairs.length === 0) {
    reportInvalid(reader, "at least one assignment");
    return undefined;
  }
  return pairs;
}

/** `mentions = 3` | `mentions = all`. */
export function readMentions(reader: OptionReader): number | "all" | undefined {
  const { value } = reader.option;
  if (value.kind === "identifier" && value.name === "all") {
    return "all";
  }
  if (
    value.kind === "number" &&
    Number.isInteger(value.value) &&
    value.value >= 0
  ) {
    return value.value;
  }
  reportInvalid(reader, "a whole number of rows, or `all`");
  return undefined;
}
