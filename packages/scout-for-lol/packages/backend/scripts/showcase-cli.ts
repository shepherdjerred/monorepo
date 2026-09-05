import type { ZodType } from "zod";

export function parseShowcaseCliValues(
  args: string[],
  flagNameSchema: ZodType<string>,
): Record<string, string> {
  const values: Record<string, string> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) {
      throw new Error(`Missing argument at index ${index.toString()}`);
    }
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const raw = arg.slice(2);
    const equalsIndex = raw.indexOf("=");
    const rawName = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex);
    const name = flagNameSchema.parse(rawName);
    if (Object.hasOwn(values, name)) {
      throw new Error(`Duplicate --${name}`);
    }

    const value =
      equalsIndex === -1 ? args[index + 1] : raw.slice(equalsIndex + 1);
    if (value === undefined || value.startsWith("--") || value.length === 0) {
      throw new Error(`Missing value for --${name}`);
    }
    if (equalsIndex === -1) {
      index += 1;
    }
    values[name] = value;
  }

  return values;
}
