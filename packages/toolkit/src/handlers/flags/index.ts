import { parseArgs } from "node:util";
import { flagsBaseUrl, runFlags, type FlagsIo } from "#lib/flags/client.ts";
import { loadToolkitConfig } from "#lib/toolkit-config.ts";

function machineToken(requested: boolean): string | undefined {
  if (!requested) return undefined;
  const token = Bun.env["FLAGS_MACHINE_TOKEN"];
  if (token === undefined || token.length === 0) {
    throw new Error(
      "FLAGS_MACHINE_TOKEN is not set. --machine needs the brokered operator token.",
    );
  }
  return token;
}

export async function handleFlagsCommand(
  subcommand: string | undefined,
  args: string[],
): Promise<void> {
  const parsed = parseArgs({
    args,
    options: {
      json: { type: "boolean", default: false },
      url: { type: "string" },
      file: { type: "string" },
      machine: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: true,
  });
  const config = await loadToolkitConfig();
  const baseUrl = flagsBaseUrl(
    parsed.values.url ?? (await config.value("flagsUrl")),
  );
  const io: FlagsIo = {
    fetch,
    stdout: (line) => {
      console.log(line);
    },
    stderr: (line) => {
      console.error(line);
    },
    readFile: (path) => Bun.file(path).text(),
    baseUrl,
    token: machineToken(parsed.values.machine),
  };
  const positionals =
    subcommand === undefined
      ? parsed.positionals
      : [subcommand, ...parsed.positionals];
  const code = await runFlags(positionals, io, {
    json: parsed.values.json,
    file: parsed.values.file,
  });
  if (code !== 0) process.exit(code);
}
