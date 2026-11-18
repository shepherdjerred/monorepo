import { z } from "zod";

const ToolchainSchema = z.object({
  tools: z.object({
    dotnet: z.string().regex(/^\d+\.\d+\.\d+$/u),
  }),
});

/** Native Windows preflight follows the same root-owned pins as mise. */
export function toolchainVersions(configuration: unknown) {
  return ToolchainSchema.parse(configuration).tools;
}

/** The .NET SDK --version output is its exact version string. */
export function toolchainVersionMatches(
  _tool: "dotnet",
  expected: string,
  output: string,
): boolean {
  return output.trim() === expected;
}
