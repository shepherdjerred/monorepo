// Allow-list policy for the `run_local_command` worker tool: which executables,
// subcommands, and arguments a model may run for read-only validation inside the
// assigned worktree. Enforced before any command reaches `sandbox-exec`.

// `mise` is deliberately absent: `mise exec -- <cmd>` / `mise exec --command`
// runs an arbitrary program, defeating the executable and read-only-argument
// allowlists (e.g. `mise exec -- sed -i …` mutates the shared worktree without
// a stack-write lease). Validation tools resolve through mise-managed PATH
// shims and are invoked directly instead.
const ALLOWED_EXECUTABLES = new Set([
  "bun",
  "bunx",
  "cargo",
  "go",
  "helm",
  "rg",
  "swift",
  "tofu",
]);
const FORBIDDEN_ARGUMENT =
  /deploy|publish|release|apply|destroy|merge|close|approve|--fix|update-snapshot/i;
const ALLOWED_FIRST_ARGUMENTS = new Map<string, Set<string>>([
  ["bun", new Set(["run", "test"])],
  ["bunx", new Set(["eslint", "turbo"])],
  ["cargo", new Set(["check", "clippy", "fmt", "test"])],
  ["go", new Set(["test", "vet"])],
  ["helm", new Set(["lint", "template"])],
  ["rg", new Set()],
  ["swift", new Set(["build", "test"])],
  ["tofu", new Set(["fmt", "plan", "validate"])],
]);
// `bun run <target>` executes arbitrary package scripts, so allow only known
// read-only script names. A wildcard here lets `bun run prettier:fix` or
// `bun run markdownlint:fix` mutate the shared stack worktree behind the
// explicit-path publication API (the `--fix` guard does not catch `:fix`
// script names).
const READONLY_BUN_SCRIPTS = new Set([
  "typecheck",
  "test",
  "lint",
  "build",
  "check",
  "verify",
]);
// A turbo task name that mutates the tree (e.g. a `lint:fix` / `format` task)
// is not a read-only validation, even with a package filter.
const MUTATING_TASK = /fix|format|write|snapshot|update/i;

function validateBunRun(args: string[]): void {
  if (args[0] !== "run") {
    return;
  }
  const script = args[1];
  if (script === undefined || !READONLY_BUN_SCRIPTS.has(script)) {
    throw new Error(
      `bun run target is not an allowed read-only script: ${script ?? "(none)"}`,
    );
  }
  if (script === "verify" && !args.includes("--affected")) {
    throw new Error("Repository-wide verification is not allowed");
  }
}

// `cargo fmt` and `tofu fmt` REWRITE tracked files in place by default; only
// their check modes (`cargo fmt --check`, `tofu fmt -check`) are read-only. A
// model-controlled validation command must never mutate the shared stack
// worktree outside `apply_patch` / the stack-write lease / the explicit
// publication paths, so the formatter subcommands are allowed only in check
// mode.
function validateCargo(args: string[]): void {
  if (args[0] !== "fmt") {
    return;
  }
  if (!args.includes("--check")) {
    throw new Error(
      "cargo fmt is only allowed with --check; without it, it rewrites tracked files",
    );
  }
}

function validateTofu(args: string[]): void {
  if (args[0] !== "fmt") {
    return;
  }
  if (!args.includes("-check")) {
    throw new Error(
      "tofu fmt is only allowed with -check; without it, it rewrites tracked files",
    );
  }
}

function validateBunxTurbo(args: string[]): void {
  if (args[0] !== "turbo" || args[1] !== "run") {
    return;
  }
  if (!args.some((argument) => argument.startsWith("--filter="))) {
    throw new Error("Turbo commands require an explicit package filter");
  }
  const mutatingTask = args
    .slice(2)
    .find(
      (argument) => !argument.startsWith("-") && MUTATING_TASK.test(argument),
    );
  if (mutatingTask !== undefined) {
    throw new Error(`Turbo task is not read-only: ${mutatingTask}`);
  }
}

export function validateWorkerCommand(
  executable: string,
  args: string[],
): void {
  if (!ALLOWED_EXECUTABLES.has(executable)) {
    throw new Error(`Executable is not allowed: ${executable}`);
  }
  if (args.some((argument) => FORBIDDEN_ARGUMENT.test(argument))) {
    throw new Error(
      "Command requests an external mutation or publication action",
    );
  }
  const allowedFirstArguments = ALLOWED_FIRST_ARGUMENTS.get(executable);
  const firstArgument = args[0];
  if (
    allowedFirstArguments === undefined ||
    (allowedFirstArguments.size > 0 &&
      (firstArgument === undefined ||
        !allowedFirstArguments.has(firstArgument)))
  ) {
    throw new Error(`Command form is not allowed for ${executable}`);
  }
  if (executable === "bun") {
    validateBunRun(args);
  }
  if (executable === "bunx") {
    validateBunxTurbo(args);
  }
  if (executable === "cargo") {
    validateCargo(args);
  }
  if (executable === "tofu") {
    validateTofu(args);
  }
}
