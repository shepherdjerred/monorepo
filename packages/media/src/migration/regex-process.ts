import { z } from "zod";
import protocol from "./regex-protocol.schema.json";
import { RegexObservationsSchema } from "./regex-evidence.ts";
import { readRegexSchema } from "./regex-schema.ts";

const requestValidator = z.fromJSONSchema(
  readRegexSchema(protocol.$defs.request),
);

/** Production passes a published executable; operator tooling may supply dotnet run. */
export async function runRegexMatcher(
  command: readonly string[],
  requests: unknown,
) {
  const input = JSON.stringify(
    requestValidator.parse({ protocolVersion: 1, requests }),
  );
  if (input.length > protocol["x-execution"].maxInputCharacters)
    throw new Error("Regex input exceeds protocol limit");
  if (command.length === 0) throw new Error("Regex executable is required");
  const child = Bun.spawn([...command], {
    stdin: new Blob([input]),
    stdout: "pipe",
    stderr: "pipe",
    timeout: protocol["x-execution"].processTimeoutMilliseconds,
    env: { ...Bun.env, DOTNET_NOLOGO: "1" },
  });
  const [status, output] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (status !== 0)
    throw new Error(`Regex matcher failed with exit code ${String(status)}`);
  return RegexObservationsSchema.parse(JSON.parse(output));
}
