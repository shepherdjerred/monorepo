import { z } from "zod";
import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";

const WorkspaceSchema = z.object({
  workspaces: z.array(
    z
      .string()
      .regex(/^(?:[\w.-]+\/)*[\w.-]+$/)
      .refine((value) =>
        value
          .split("/")
          .every((segment) => segment !== "." && segment !== ".."),
      ),
  ),
});
const ManifestSchema = z.object({
  name: z.string().regex(/^(?:@[a-z0-9_.-]+\/)?[a-z0-9_.-]+$/),
});

/** Resolve check targets from the base revision, never agent-written metadata. */
export async function verificationCommand(input: {
  checkout: string;
  baseBranch: string;
  paths: readonly string[];
  run: CommandRunner;
}): Promise<string[]> {
  const read = async (file: string): Promise<unknown> => {
    const result = requireSuccess(
      "Read trusted verification manifest",
      await input.run(["git", "show", `origin/${input.baseBranch}:${file}`], {
        cwd: input.checkout,
      }),
    );
    return JSON.parse(result.stdout);
  };
  const { workspaces } = WorkspaceSchema.parse(await read("package.json"));
  const ordered = workspaces.toSorted(
    (left, right) => right.length - left.length,
  );
  const owners = new Set<string>();
  for (const file of input.paths) {
    const owner = ordered.find((directory) => file.startsWith(`${directory}/`));
    // Root machinery or a newly added workspace requires the repository gate.
    if (owner === undefined) return ["bun", "run", "verify"];
    owners.add(owner);
  }
  if (owners.size === 0)
    throw new Error("Cannot verify a publication without changed files");
  const names = await Promise.all(
    [...owners]
      .sort()
      .map(
        async (owner) =>
          ManifestSchema.parse(await read(`${owner}/package.json`)).name,
      ),
  );
  return [
    "bun",
    "--no-install",
    "--bun",
    "turbo",
    "run",
    "build",
    "typecheck",
    "test",
    "lint",
    ...names.map((name) => `--filter=${name}`),
  ];
}
