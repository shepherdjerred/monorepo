import { createHash } from "node:crypto";
import path from "node:path";
import { shardPathspecs } from "./repo-shards.ts";

const REPO_ROOT = path.join(import.meta.dir, "..", "..");
const INPUTS_KEY = "CI_ROOT_CHECK_INPUTS_SHA256";

function git(repository: string, args: string[]) {
  return Bun.spawnSync(["git", ...args], { cwd: repository });
}

/** Hash the checked index semantics, not its checkout-specific stat cache. */
export async function rootCheckInputsHash(
  environment: Readonly<Record<string, string | undefined>>,
  repository = REPO_ROOT,
): Promise<string> {
  const entries = git(repository, [
    "ls-files",
    "--stage",
    "--eol",
    "-v",
    "-z",
    "--",
    ...shardPathspecs("root"),
  ]);
  if (entries.exitCode !== 0) {
    throw new Error(
      `Cannot fingerprint root check inputs: ${entries.stderr.toString()}`,
    );
  }
  const hash = createHash("sha256").update(entries.stdout);
  // Explicit Turbo globs can omit force-added ignored paths. Include their
  // working bytes too, so modifying one without staging cannot reuse a pass.
  const ignored = git(repository, [
    "ls-files",
    "--cached",
    "--ignored",
    "--exclude-standard",
    "-z",
    "--",
    ...shardPathspecs("root"),
  ]);
  if (ignored.exitCode !== 0) {
    throw new Error(
      `Cannot list tracked ignored root inputs: ${ignored.stderr.toString()}`,
    );
  }
  for (const file of ignored.stdout.toString().split("\0")) {
    if (file === "") continue;
    const input = Bun.file(path.join(repository, file));
    hash.update(JSON.stringify(file)).update("\0");
    hash.update(
      (await input.exists())
        ? createHash("sha256")
            .update(new Uint8Array(await input.arrayBuffer()))
            .digest("hex")
        : "missing",
    );
  }
  // Changed-file checks depend on base..HEAD and its availability, including
  // whether shallow history permits the ancestor check. Preserve that signal
  // without hashing refs, logs, FETCH_HEAD, locks or the shallow-file bytes.
  const base = environment["CI_CHANGED_BASE"]?.trim();
  if (
    base !== undefined &&
    base !== "" &&
    git(repository, ["cat-file", "-e", `${base}^{commit}`]).exitCode === 0 &&
    git(repository, ["merge-base", "--is-ancestor", base, "HEAD"]).exitCode ===
      0
  ) {
    const diff = git(repository, [
      "diff",
      "--no-renames",
      "--name-only",
      "-z",
      base,
      "HEAD",
    ]);
    if (diff.exitCode === 0) hash.update("changed\0").update(diff.stdout);
    else hash.update("full\0");
  } else hash.update("full\0");
  return hash.digest("hex");
}

export async function rootCheckEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  repository = REPO_ROOT,
): Promise<Record<string, string | undefined>> {
  return {
    ...environment,
    [INPUTS_KEY]: await rootCheckInputsHash(environment, repository),
  };
}

export async function assertRootCheckInputs(
  environment: Readonly<Record<string, string | undefined>> = Bun.env,
  repository = REPO_ROOT,
): Promise<void> {
  const turboHash = environment["TURBO_HASH"];
  if (turboHash === undefined || turboHash === "") return;
  const expected = environment[INPUTS_KEY];
  if (
    expected === undefined ||
    !/^[a-f0-9]{64}$/u.test(expected) ||
    expected !== (await rootCheckInputsHash(environment, repository))
  ) {
    throw new Error(
      "Root checks under Turbo require freshly fingerprinted inputs. Use bun run verify -- --filter=//, or run bun run <check>-root directly without Turbo.",
    );
  }
}
