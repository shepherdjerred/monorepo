import { z } from "zod";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { AutonomousBlocker } from "#src/domain/autonomy.ts";
import { requireSuccess, type CommandRunner } from "#src/runtime/process.ts";

const InventorySchema = z.object({ workspaces: z.array(z.string().min(1)) });
const PROTECTED_WORKSPACES = new Set([
  "packages/justin-principal-engineer",
  "packages/code-review",
  "packages/config",
  "packages/feature-flags",
  "packages/homelab",
  "packages/woodpecker-config-extension",
  "packages/eslint-config",
  "packages/pr-fleet-controller",
  "packages/version-catalog",
  "packages/temporal",
]);
const PROTECTED_PATH =
  /(?:^|\/)(?:AGENTS\.md|CLAUDE\.md|SKILL\.md|package\.json|[^/]*\.lock|[^/]*lock\.json|\.agents|\.github|\.woodpecker|skills)(?:\/|$)|(?:^|\/)(?:auth(?:entication|orization)?|credentials?|secrets?|tokens?)(?:[./_-]|$)|^packages\/toolkit\/src\/(?:commands\/pr\/(?:health|review)|lib\/(?:woodpecker|review|git))/i;
const CREDENTIAL_EDIT =
  /GH_TOKEN|LINEAR_API_KEY|WOODPECKER_TOKEN|OP_SERVICE_ACCOUNT_TOKEN|op:\/\/|privateKey|apiKey|Authorization|authToken/i;

function workspaceOwner(
  file: string,
  workspaces: readonly string[],
): string | null {
  if (
    path.isAbsolute(file) ||
    file.split("/").some((part) => part === ".." || part === ".") ||
    PROTECTED_PATH.test(file)
  )
    throw new AutonomousBlocker(`Autonomous scope excludes ${file}`);
  const owner = workspaces.find((workspace) =>
    file.startsWith(`${workspace}/`),
  );
  if (owner === undefined || PROTECTED_WORKSPACES.has(owner))
    throw new AutonomousBlocker(`Autonomous scope excludes ${file}`);
  if (
    /\.mdx?$/.test(file) &&
    file.startsWith("packages/docs/wiki/src/content/docs/")
  )
    return null;
  const relative = file.slice(owner.length + 1);
  if (!(
    relative === "README.md" ||
    relative.startsWith("src/") ||
    relative.startsWith("test/") ||
    relative.startsWith("tests/")
  ))
    throw new AutonomousBlocker(
      `Autonomous scope requires workspace source, tests, or documentation: ${file}`,
    );
  return owner;
}

async function assertNoSymlink(checkout: string, file: string): Promise<void> {
  let target = path.join(checkout, file);
  while (target !== checkout) {
    try {
      const stat = await lstat(target);
      if (stat.isSymbolicLink())
        throw new AutonomousBlocker(
          `Autonomous scope excludes symbolic links: ${file}`,
        );
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ))
        throw error;
    }
    target = path.dirname(target);
  }
}

/** Read inventory from main and check the entire branch, including earlier turns. */
export async function assertAutonomousScope(input: {
  checkout: string;
  baseBranch: string;
  paths: readonly string[];
  run: CommandRunner;
}): Promise<void> {
  const read = async (args: readonly string[]) =>
    requireSuccess(
      "Inspect autonomous scope",
      await input.run(["git", ...args], { cwd: input.checkout }),
    ).stdout;
  const inventory = InventorySchema.parse(
    JSON.parse(await read(["show", `origin/${input.baseBranch}:package.json`])),
  );
  const workspaces = inventory.workspaces.toSorted(
    (a, b) => b.length - a.length,
  );
  const untrackedList = await read([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  const untracked = new Set(untrackedList.split("\0"));
  const owners = new Set<string>();
  for (const file of input.paths) {
    const owner = workspaceOwner(file, workspaces);
    await assertNoSymlink(input.checkout, file);
    if (
      untracked.has(file) &&
      CREDENTIAL_EDIT.test(
        await Bun.file(path.join(input.checkout, file)).text(),
      )
    )
      throw new AutonomousBlocker(
        "Autonomous scope excludes credential and authentication changes",
      );
    if (owner !== null) owners.add(owner);
  }
  if (owners.size > 1)
    throw new AutonomousBlocker(
      "Autonomous scope is limited to one existing workspace plus related documentation",
    );
  const diff = await read([
    "diff",
    "--no-ext-diff",
    "--unified=0",
    `origin/${input.baseBranch}`,
    "--",
    ...input.paths,
  ]);
  if (
    diff
      .split("\n")
      .some((line) => /^[+-](?![+-])/.test(line) && CREDENTIAL_EDIT.test(line))
  )
    throw new AutonomousBlocker(
      "Autonomous scope excludes credential and authentication changes",
    );
  const modes = await read([
    "diff",
    "--raw",
    `origin/${input.baseBranch}`,
    "--",
    ...input.paths,
  ]);
  if (modes.split("\n").some((line) => /^:\d+ 120000 /.test(line)))
    throw new AutonomousBlocker("Autonomous scope excludes symbolic links");
}
