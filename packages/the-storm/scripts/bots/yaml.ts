/**
 * A tiny YAML emitter for the personality files: maps in insertion order, lists
 * of scalars, strings, finite numbers and booleans. Output is already in
 * Prettier's YAML style (two-space indent, no trailing spaces, plain scalars
 * where safe) so a format pass leaves it untouched.
 */

type Scalar = string | number | boolean;
type Value = Scalar | Scalar[] | Mapping;
// An index signature rather than Record: the alias refers to itself.
type Mapping = { [key: string]: Value };

/** Plain (unquoted) scalars that YAML would not read as something else. */
const PLAIN = /^[a-z_][\w .,!?'()-]*[\w.!?')]$/i;
const KEY = /^[a-z_]\w*$/i;
const RESERVED = new Set([
  "true",
  "false",
  "yes",
  "no",
  "on",
  "off",
  "null",
  "y",
  "n",
  "~",
]);

function scalar(value: Scalar): string {
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(`cannot emit non-finite number ${String(value)}`);
    }
    return String(value);
  }
  const plainSafe =
    PLAIN.test(value) &&
    !RESERVED.has(value.toLowerCase()) &&
    !value.includes(": ") &&
    !value.includes(" #");
  return plainSafe ? value : JSON.stringify(value);
}

function emitList(items: Scalar[], indent: number, lines: string[]): void {
  const pad = " ".repeat(indent);
  for (const item of items) {
    lines.push(`${pad}- ${scalar(item)}`);
  }
}

function emitRecord(record: Mapping, indent: number, lines: string[]): void {
  const pad = " ".repeat(indent);
  for (const [key, child] of Object.entries(record)) {
    if (!KEY.test(key)) {
      throw new TypeError(`unsupported YAML key: ${key}`);
    }
    if (typeof child !== "object") {
      lines.push(`${pad}${key}: ${scalar(child)}`);
    } else if (Array.isArray(child)) {
      lines.push(child.length === 0 ? `${pad}${key}: []` : `${pad}${key}:`);
      emitList(child, indent + 2, lines);
    } else {
      lines.push(
        Object.keys(child).length === 0 ? `${pad}${key}: {}` : `${pad}${key}:`,
      );
      emitRecord(child, indent + 2, lines);
    }
  }
}

/** The YAML document for `value`, ending in one newline. */
export function toYaml(value: Mapping): string {
  const lines: string[] = [];
  emitRecord(value, 0, lines);
  return `${lines.join("\n")}\n`;
}
