import { z } from "zod";

const ToolchainSchema = z.object({
  tools: z.object({
    rust: z.string().regex(/^\d+\.\d+\.\d+$/u),
    dotnet: z.string().regex(/^\d+\.\d+\.\d+$/u),
  }),
});

/** Native Windows preflight follows the same root-owned pins as mise. */
export function toolchainVersions(configuration: unknown) {
  return ToolchainSchema.parse(configuration).tools;
}

/** The compiler identity includes a build suffix; the SDK output is just its version. */
export function toolchainVersionMatches(
  tool: "rust" | "dotnet",
  expected: string,
  output: string,
): boolean {
  return tool === "dotnet"
    ? output.trim() === expected
    : /^rustc (\S+)(?:\s|$)/u.exec(output.trim())?.[1] === expected;
}
