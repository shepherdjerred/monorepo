import { parseArgs } from "node:util";
import { z } from "zod";
import { usageError } from "#lib/artifacts/errors.ts";

type Spec = NonNullable<Parameters<typeof parseArgs>[0]>["options"];

/** `parseArgs` that reports a bad flag as a usage error naming the command. */
export function parseCommandArgs<const O extends NonNullable<Spec>>(
  command: string,
  args: string[],
  options: O,
) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw usageError(
      `${error instanceof Error ? error.message : String(error)}. Run \`toolkit artifacts ${command} --help\`.`,
    );
  }
}

const Uuid = z.uuid();

export function parseId(value: string | undefined, what: string): string {
  const parsed = Uuid.safeParse(value);
  if (!parsed.success)
    throw usageError(
      `${what} must be an id (a UUID), as printed by \`toolkit artifacts\`.`,
    );
  return parsed.data;
}

export function onlyPositional(
  command: string,
  positionals: readonly string[],
  what: string,
): string {
  const [first, ...rest] = positionals;
  if (first === undefined || rest.length > 0)
    throw usageError(
      `Usage: toolkit artifacts ${command} <${what}>. Run \`toolkit artifacts ${command} --help\`.`,
    );
  return first;
}

export function noPositionals(
  command: string,
  positionals: readonly string[],
): void {
  if (positionals.length > 0)
    throw usageError(
      `toolkit artifacts ${command} takes no arguments. Run \`toolkit artifacts ${command} --help\`.`,
    );
}
