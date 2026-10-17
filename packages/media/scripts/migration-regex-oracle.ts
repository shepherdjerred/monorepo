import { runRegexMatcher } from "#migration/regex-process.ts";
import protocol from "#migration/regex-protocol.schema.json";

/** Uses source-compatible .NET regexes with per-match timeout plus a process deadline. */
export async function observeSourceRegexes(value: unknown) {
  return await runRegexMatcher(
    [
      "dotnet",
      "run",
      "--project",
      `${import.meta.dirname}/regex-oracle/RegexOracle.csproj`,
      "--verbosity",
      "quiet",
      "--no-launch-profile",
    ],
    value,
  );
}

if (import.meta.main) {
  const input = await Bun.stdin.text();
  if (input.length > protocol["x-execution"].maxInputCharacters)
    throw new Error("Oracle input exceeds limit");
  await Bun.write(
    Bun.stdout,
    `${JSON.stringify(await observeSourceRegexes(JSON.parse(input)))}\n`,
  );
}
