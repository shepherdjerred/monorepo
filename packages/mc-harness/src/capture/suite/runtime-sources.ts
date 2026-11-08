import path from "node:path";
import { z } from "zod";
import { command } from "./process.ts";

export const RuntimeSourcePathSchema = z
  .string()
  .refine(
    (file) =>
      !file
        .split("/")
        .some((part) => part === ".." || part === "." || part === "") &&
      /^(?:packages\/(?:mc-harness|the-storm|toolkit)\/|packages\/homelab\/scripts\/minecraft\/|bun\.lock$|package\.json$)/u.test(
        file,
      ),
    "Invalid runtime source path",
  );

/** Refuse working-copy inputs the bounded runtime archive cannot preserve. */
export async function verifyRuntimeInputs(
  repoRoot: string,
  suiteFile?: string,
  git: (argv: string[]) => Promise<string> = command,
): Promise<void> {
  if (suiteFile !== undefined)
    RuntimeSourcePathSchema.parse(path.relative(repoRoot, suiteFile));
  const paths = await Promise.all([
    git(["git", "-C", repoRoot, "diff", "--name-only", "-z", "HEAD"]),
    git([
      "git",
      "-C",
      repoRoot,
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ]),
  ]);
  const unsupported = [
    ...new Set(paths.flatMap((output) => output.split("\0"))),
  ].filter(
    (file) =>
      file !== "" &&
      !file.startsWith("packages/ts-mc-docs/") &&
      !RuntimeSourcePathSchema.safeParse(file).success,
  );
  if (unsupported.length > 0)
    throw new Error(
      `Working-copy runtime inputs are outside the retained source roots; commit them before capture: ${unsupported.join(", ")}`,
    );
}
