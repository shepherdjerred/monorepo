/**
 * Minecraft coordinates are often negative (`-6,-61,-6`, `tp x -60 0`), and
 * node:util `parseArgs` reads any token starting with `-` as an option. This
 * rewrites argv before parsing so agents never need `--opt=value` or `--`:
 * values of string options are attached with `=`, and every positional
 * (including negative numbers) moves after a single `--`.
 */
export type ArgvOptionSpec = Readonly<
  Record<string, { type: "string" | "boolean"; short?: string | undefined }>
>;

const NEGATIVE_NUMBER = /^-\d/u;

export function normalizeArgv(
  args: readonly string[],
  options: ArgvOptionSpec,
): string[] {
  const shortToLong = new Map(
    Object.entries(options).flatMap(([name, spec]) =>
      spec.short === undefined ? [] : [[spec.short, name] as const],
    ),
  );
  const flags: string[] = [];
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? "";
    if (token === "--") {
      positionals.push(...args.slice(index + 1));
      break;
    }
    if (
      token === "-" ||
      !token.startsWith("-") ||
      NEGATIVE_NUMBER.test(token)
    ) {
      positionals.push(token);
      continue;
    }
    if (token.includes("=")) {
      flags.push(token);
      continue;
    }
    const name = token.startsWith("--")
      ? token.slice(2)
      : shortToLong.get(token.slice(1));
    const spec = name === undefined ? undefined : options[name];
    const value = args[index + 1];
    if (name !== undefined && value !== undefined && spec?.type === "string") {
      flags.push(`--${name}=${value}`);
      index += 1;
      continue;
    }
    // Booleans, and unknown options for parseArgs to reject loudly.
    flags.push(token);
  }
  return positionals.length === 0 ? flags : [...flags, "--", ...positionals];
}

/** True when the user asked for help before any `--`. */
export function wantsHelp(args: readonly string[]): boolean {
  const end = args.indexOf("--");
  const head = end === -1 ? args : args.slice(0, end);
  return head.includes("--help") || head.includes("-h");
}
