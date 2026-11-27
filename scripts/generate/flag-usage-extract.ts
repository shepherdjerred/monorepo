/**
 * Syntactic flag-key extraction for the flag-usage index.
 *
 * Pure functions over one source text: which paths are candidate read sites,
 * and which string literals in a TypeScript or Java source name a managed key
 * in a read position. `flag-usage.ts` applies namespace scoping and builds the
 * committed index from these hits.
 */

import ts from "typescript";
import { z } from "zod";

import { deriveKeyNames } from "../../packages/config/src/source.ts";

export const FlagUsageKindSchema = z.enum([
  "config-flag-name",
  "config-derived",
  "call-argument",
  "array-element",
  "constant",
  "java",
]);
export type FlagUsageKind = z.infer<typeof FlagUsageKindSchema>;

export type FlagUsageHit = {
  readonly key: string;
  readonly kind: FlagUsageKind;
};

const SCANNED_EXTENSIONS = [".ts", ".tsx", ".java"] as const;

const EXCLUDED_SEGMENTS = new Set([
  "node_modules",
  "dist",
  "sandbox",
  "generated",
  "__generated__",
  "__tests__",
  "__mocks__",
  "__fixtures__",
  "test",
  "tests",
  "test-fixtures",
  "testing",
  "fixtures",
]);

const EXCLUDED_FILE_PATTERN =
  /\.(?:test|spec|test-support|generated)\.[cm]?[jt]sx?$|\.d\.ts$/u;

/** Whether a repository-relative path is a candidate read site at all. */
export function isScannedPath(file: string): boolean {
  if (!SCANNED_EXTENSIONS.some((extension) => file.endsWith(extension))) {
    return false;
  }
  const segments = file.split("/");
  const directories = segments.slice(0, -1);
  if (directories.some((segment) => EXCLUDED_SEGMENTS.has(segment))) {
    return false;
  }
  // Only The Storm's production Java reads flags through FlagsClient.
  return file.endsWith(".java")
    ? file.startsWith("packages/the-storm/") && file.includes("/src/main/")
    : !EXCLUDED_FILE_PATTERN.test(segments.at(-1) ?? "");
}

/** Strip wrappers that do not change which value a literal provides. */
function outerExpression(node: ts.Node): ts.Node {
  let current = node;
  while (
    (ts.isParenthesizedExpression(current.parent) ||
      ts.isAsExpression(current.parent) ||
      ts.isSatisfiesExpression(current.parent) ||
      ts.isTypeAssertionExpression(current.parent) ||
      ts.isNonNullExpression(current.parent)) &&
    current.parent.expression === current
  ) {
    current = current.parent;
  }
  return current;
}

function innerExpression(node: ts.Expression): ts.Expression {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNoSubstitutionTemplateLiteral(name)
  ) {
    return name.text;
  }
  return ts.isComputedPropertyName(name) &&
    ts.isStringLiteralLike(name.expression)
    ? name.expression.text
    : undefined;
}

function property(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  for (const candidate of object.properties) {
    if (
      ts.isPropertyAssignment(candidate) &&
      propertyName(candidate.name) === name
    ) {
      return candidate;
    }
  }
  return undefined;
}

function isNamesFlagValue(outer: ts.Node): boolean {
  const assignment = outer.parent;
  if (
    !ts.isPropertyAssignment(assignment) ||
    assignment.initializer !== outer ||
    propertyName(assignment.name) !== "flag"
  ) {
    return false;
  }
  const names = assignment.parent;
  if (!ts.isObjectLiteralExpression(names)) return false;
  const namesAssignment = outerExpression(names).parent;
  return (
    ts.isPropertyAssignment(namesAssignment) &&
    propertyName(namesAssignment.name) === "names"
  );
}

function literalKind(literal: ts.StringLiteralLike): FlagUsageKind | undefined {
  const outer = outerExpression(literal);
  const parent = outer.parent;
  if (
    (ts.isCallExpression(parent) || ts.isNewExpression(parent)) &&
    parent.arguments?.some((argument) => argument === outer) === true
  ) {
    return "call-argument";
  }
  if (ts.isArrayLiteralExpression(parent)) return "array-element";
  if (
    (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) &&
    parent.initializer === outer
  ) {
    return "constant";
  }
  if (isNamesFlagValue(outer)) return "config-flag-name";
  // A key held as an object property value, such as a map of aliases to keys.
  return ts.isPropertyAssignment(parent) && parent.initializer === outer
    ? "constant"
    : undefined;
}

/**
 * The flag key a config definition derives from its property name, or
 * `undefined` when the property is not a flag-sourced definition or names its
 * flag explicitly (that literal is a `config-flag-name` hit instead).
 */
function derivedFlagKey(assignment: ts.PropertyAssignment): string | undefined {
  const initializer = innerExpression(assignment.initializer);
  if (!ts.isObjectLiteralExpression(initializer)) return undefined;
  const sources = property(initializer, "sources");
  if (sources === undefined) return undefined;
  const sourceList = innerExpression(sources.initializer);
  if (
    !ts.isArrayLiteralExpression(sourceList) ||
    !sourceList.elements.some(
      (element) => ts.isStringLiteralLike(element) && element.text === "flag",
    )
  ) {
    return undefined;
  }
  const names = property(initializer, "names");
  if (names !== undefined) {
    const namesObject = innerExpression(names.initializer);
    // A non-literal `names` cannot be resolved syntactically; do not guess.
    if (!ts.isObjectLiteralExpression(namesObject)) return undefined;
    if (property(namesObject, "flag") !== undefined) return undefined;
  }
  const key = propertyName(assignment.name);
  return key === undefined ? undefined : deriveKeyNames(key).flag;
}

/** Flag-key hits in one TypeScript source, before scope filtering. */
export function extractTypeScriptHits(
  text: string,
  file: string,
  keys: ReadonlySet<string>,
): FlagUsageHit[] {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const hits: FlagUsageHit[] = [];
  const visit = (node: ts.Node): void => {
    // Literal types declare the key space; they are never reads. Heritage
    // clauses (`extends mixin("…")`) are expressions and stay visible.
    if (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node)) {
      return;
    }
    if (ts.isStringLiteralLike(node) && keys.has(node.text)) {
      const kind = literalKind(node);
      if (kind !== undefined) hits.push({ key: node.text, kind });
    } else if (ts.isPropertyAssignment(node)) {
      const key = derivedFlagKey(node);
      if (key !== undefined && keys.has(key)) {
        hits.push({ key, kind: "config-derived" });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return hits;
}

function skipPast(text: string, index: number, terminator: string): number {
  const end = text.indexOf(terminator, index);
  return end === -1 ? text.length : end + terminator.length;
}

function skipQuoted(text: string, index: number, quote: string): number {
  let cursor = index + quote.length;
  while (cursor < text.length) {
    if (text[cursor] === "\\") {
      cursor += 2;
    } else if (text.startsWith(quote, cursor)) {
      return cursor + quote.length;
    } else if (quote.length === 1 && text[cursor] === "\n") {
      return cursor;
    } else {
      cursor += 1;
    }
  }
  return cursor;
}

/** Flag-key string literals in one Java source, ignoring comments. */
export function extractJavaHits(
  text: string,
  keys: ReadonlySet<string>,
): FlagUsageHit[] {
  const hits: FlagUsageHit[] = [];
  let index = 0;
  while (index < text.length) {
    if (text.startsWith("//", index)) {
      index = skipPast(text, index, "\n");
    } else if (text.startsWith("/*", index)) {
      index = skipPast(text, index + 2, "*/");
    } else if (text.startsWith('"""', index)) {
      index = skipQuoted(text, index, '"""');
    } else if (text[index] === "'") {
      index = skipQuoted(text, index, "'");
    } else if (text[index] === '"') {
      const end = skipQuoted(text, index, '"');
      const value = text.slice(index + 1, end - 1);
      if (keys.has(value)) hits.push({ key: value, kind: "java" });
      index = end;
    } else {
      index += 1;
    }
  }
  return hits;
}
