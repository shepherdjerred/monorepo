// The model can pass pokemonctl arguments, never a shell command or program.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { realpath } from "node:fs/promises";

const ARGUMENTS = z
  .array(
    z
      .string()
      .max(32_000)
      .refine((value) => !value.includes("\0")),
  )
  .min(1)
  .max(32);
const TOOL_ENVIRONMENT = [
  "PATH",
  "HOME",
  "POKEMONCTL_URL",
  "POKEMONCTL_TOKEN",
  "POKEMONCTL_GOAL_ID",
];

export async function runPokemonctl(
  args: string[],
  environment: Readonly<Record<string, string | undefined>>,
  signal?: AbortSignal,
) {
  ARGUMENTS.parse(args);
  const env: Record<string, string> = {};
  for (const name of TOOL_ENVIRONMENT) {
    const value = environment[name];
    if (value !== undefined) env[name] = value;
  }
  const script = path.join(import.meta.dir, "pokemonctl.ts");
  const child = Bun.spawn([process.execPath, script, ...args], {
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    ...(signal === undefined ? {} : { signal, killSignal: "SIGKILL" }),
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  const content: (
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  )[] = [{ type: "text", text: code === 0 ? stdout : stderr }];
  if (
    code === 0 &&
    (args[0] === "screenshot" ||
      (args[0] === "observe" && args.includes("--screenshot")))
  ) {
    content.push(
      await screenshotImage(
        stdout,
        environment["POKEMONCTL_SCREENSHOT_DIRECTORY"],
      ),
    );
  }
  return { content, isError: code !== 0 };
}

async function screenshotImage(stdout: string, root: string | undefined) {
  if (root === undefined) throw new Error("Missing goal screenshot directory");
  const parsed: unknown = JSON.parse(stdout);
  // observe nests the screenshot metadata; screenshot returns it directly.
  const metadata = z
    .union([
      z.object({ path: z.string() }),
      z.object({ screenshot: z.object({ path: z.string() }) }),
    ])
    .parse(parsed);
  const file = "path" in metadata ? metadata.path : metadata.screenshot.path;
  const [resolvedRoot, resolvedFile] = await Promise.all([
    realpath(root),
    realpath(file),
  ]);
  if (
    !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`) ||
    !/^pokemon-\d+-\d+\.png$/u.test(path.basename(resolvedFile))
  )
    throw new Error("Goal screenshot escaped its output directory");
  return {
    type: "image" as const,
    data: Buffer.from(await Bun.file(resolvedFile).arrayBuffer()).toString(
      "base64",
    ),
    mimeType: "image/png",
  };
}

if (import.meta.main) {
  const server = new McpServer({ name: "pokemonctl", version: "1.0.0" });
  server.registerTool(
    "pokemonctl",
    {
      description:
        'Run one existing pokemonctl semantic game command. Pass argument words as an array, for example ["observe"] or ["move","north","--tiles","1"]. Use ["help"] for the complete command reference. Shell syntax is never evaluated.',
      inputSchema: { args: ARGUMENTS },
    },
    async ({ args }, context) => runPokemonctl(args, Bun.env, context.signal),
  );
  await server.connect(new StdioServerTransport());
}
