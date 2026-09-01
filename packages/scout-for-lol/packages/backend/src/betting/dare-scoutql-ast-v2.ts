import { z } from "zod";

export type RelationalScoutQlAstValue = unknown;

const AstObjectSchema = z.record(z.string(), z.unknown());
const AstArraySchema = z.array(z.unknown());
const AstConstantSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export type AstObject = z.infer<typeof AstObjectSchema>;

export class DareScoutQlProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DareScoutQlProfileError";
  }
}

export function astObject(value: unknown, label: string): AstObject {
  const parsed = AstObjectSchema.safeParse(value);
  if (!parsed.success) {
    throw new DareScoutQlProfileError(`Dare ScoutQL requires ${label}.`);
  }
  return parsed.data;
}

export function astArray(
  value: unknown,
  label: string,
): RelationalScoutQlAstValue[] {
  const parsed = AstArraySchema.safeParse(value);
  if (!parsed.success) {
    throw new DareScoutQlProfileError(`Dare ScoutQL requires ${label}.`);
  }
  return parsed.data;
}

export function astString(value: unknown, label: string): string {
  const parsed = z.string().safeParse(value);
  if (!parsed.success) {
    throw new DareScoutQlProfileError(`Dare ScoutQL requires ${label}.`);
  }
  return parsed.data;
}

export function expressionClass(object: AstObject): string {
  return astString(object["class"], "an expression class");
}

export function expressionType(object: AstObject): string {
  return astString(object["type"], "an expression type");
}

export function constantValue(
  expression: RelationalScoutQlAstValue,
): string | number | boolean | null {
  const object = astObject(expression, "a constant expression");
  if (expressionClass(object) === "CAST") {
    const value = constantValue(object["child"]);
    const castType = astObject(object["cast_type"], "a cast type");
    if (typeof value === "string" && castType["id"] === "BOOLEAN") {
      if (value === "t" || value === "true") return true;
      if (value === "f" || value === "false") return false;
    }
    return value;
  }
  if (expressionClass(object) !== "CONSTANT") {
    throw new DareScoutQlProfileError(
      "Dare ScoutQL macro arguments must be literals.",
    );
  }
  const value = astObject(object["value"], "a constant value");
  if (value["is_null"] === true) return null;
  const parsed = AstConstantSchema.safeParse(value["value"]);
  if (parsed.success) return parsed.data;
  throw new DareScoutQlProfileError(
    "Dare ScoutQL contains an unsupported literal.",
  );
}

function requiredArgument(
  children: readonly RelationalScoutQlAstValue[],
  index: number,
  macroName: string,
): string | number | boolean | null {
  const child = children[index];
  if (child === undefined) {
    throw new DareScoutQlProfileError(
      `${macroName} is missing argument ${index.toString()}.`,
    );
  }
  return constantValue(child);
}

export function requiredStringArgument(
  children: readonly RelationalScoutQlAstValue[],
  index: number,
  macroName: string,
): string {
  const value = requiredArgument(children, index, macroName);
  if (typeof value !== "string") {
    throw new DareScoutQlProfileError(
      `${macroName} argument ${index.toString()} must be text.`,
    );
  }
  return value;
}

export function requiredNumberArgument(
  children: readonly RelationalScoutQlAstValue[],
  index: number,
  macroName: string,
): number {
  const value = requiredArgument(children, index, macroName);
  if (typeof value !== "number") {
    throw new DareScoutQlProfileError(
      `${macroName} argument ${index.toString()} must be numeric.`,
    );
  }
  return value;
}

export function nullableStringArgument(
  children: readonly RelationalScoutQlAstValue[],
  index: number,
  macroName: string,
): string | null {
  const value = requiredArgument(children, index, macroName);
  if (value === null || typeof value === "string") return value;
  throw new DareScoutQlProfileError(
    `${macroName} argument ${index.toString()} must be text or null.`,
  );
}

export function nullableNumberArgument(
  children: readonly RelationalScoutQlAstValue[],
  index: number,
  macroName: string,
): number | null {
  const value = requiredArgument(children, index, macroName);
  if (value === null || typeof value === "number") return value;
  throw new DareScoutQlProfileError(
    `${macroName} argument ${index.toString()} must be numeric or null.`,
  );
}

export function functionExpression(expression: RelationalScoutQlAstValue): {
  name: string;
  children: RelationalScoutQlAstValue[];
  object: AstObject;
} {
  const object = astObject(expression, "a function expression");
  if (expressionClass(object) !== "FUNCTION") {
    throw new DareScoutQlProfileError(
      "Dare ScoutQL requires a closed Dare function.",
    );
  }
  return {
    name: astString(object["function_name"], "a function name"),
    children: astArray(object["children"], "function arguments"),
    object,
  };
}

export function flattenAnd(
  expression: RelationalScoutQlAstValue,
): RelationalScoutQlAstValue[] {
  const object = astObject(expression, "a WHERE predicate");
  if (
    expressionClass(object) === "CONJUNCTION" &&
    expressionType(object) === "CONJUNCTION_AND"
  ) {
    return astArray(object["children"], "WHERE conjunctions").flatMap((child) =>
      flattenAnd(child),
    );
  }
  return [expression];
}

export function limitFromNode(node: AstObject, label: string): number {
  const limitModifier = astArray(node["modifiers"], `${label} modifiers`)
    .map((modifier) => astObject(modifier, `${label} modifier`))
    .find((modifier) => modifier["type"] === "LIMIT_MODIFIER");
  if (limitModifier === undefined) {
    throw new DareScoutQlProfileError(`${label} requires a LIMIT.`);
  }
  const limit = limitModifier["limit"];
  if (limit === undefined) {
    throw new DareScoutQlProfileError(`${label} requires a numeric LIMIT.`);
  }
  const value = constantValue(limit);
  if (typeof value !== "number") {
    throw new DareScoutQlProfileError(`${label} LIMIT must be numeric.`);
  }
  return value;
}
