function argsBeforeBoundary(args: readonly string[]): readonly string[] {
  const boundary = args.indexOf("--");
  return boundary === -1 ? args : args.slice(0, boundary);
}

function parseGcxOutputArg(
  arg: string,
  next = "",
): { readonly format: string; readonly consumesNext: boolean } | null {
  if (arg === "-o" || arg === "--output") {
    return { format: next, consumesNext: true };
  }
  if (arg.startsWith("--output=")) {
    return { format: arg.slice("--output=".length), consumesNext: false };
  }
  if (arg.startsWith("-o") && arg.length > 2) {
    const format = arg.startsWith("-o=") ? arg.slice(3) : arg.slice(2);
    return { format, consumesNext: false };
  }
  return null;
}

/**
 * True when an explicit non-`agents` `-o`/`--output` flag is given before `--`,
 * so gcx's auto-detected agent hint line does not pollute machine-readable stdout.
 */
export function hasNonAgentGcxOutput(args: readonly string[]): boolean {
  const candidates = argsBeforeBoundary(args);
  let format: string | undefined;
  for (let index = 0; index < candidates.length; index += 1) {
    const arg = candidates[index];
    if (arg === undefined) {
      continue;
    }
    const parsed = parseGcxOutputArg(arg, candidates[index + 1]);
    if (parsed !== null) {
      format = parsed.format;
      if (parsed.consumesNext) {
        index += 1;
      }
    }
  }
  return (
    format !== undefined &&
    format.length > 0 &&
    format.toLowerCase() !== "agents"
  );
}
