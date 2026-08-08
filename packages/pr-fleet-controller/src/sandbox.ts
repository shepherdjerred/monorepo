// macOS `sandbox-exec` policy and environment scrubbing for model-driven worker
// validation commands. `run_local_command` arguments are model-controlled and
// its stdout is returned to the remote model, so reads must be confined to the
// assigned worktree plus known toolchain paths (not a deny-list of guessed
// credential locations), and credential-bearing env vars must be stripped.

// System roots the toolchain must read (compilers, shared libraries, Homebrew
// under /opt, device nodes). `/private/etc` (the target of the /etc symlink)
// covers CA certs and host config. Deliberately NOT the whole `/private`: that
// hierarchy also holds same-user temp and application-cache data under
// /private/tmp and /private/var/folders, whose contents would be exfiltrated
// through tool output — the process's own TMPDIR is granted separately below.
// Everything else is denied by default (an allowlist, not a credential denylist).
import path from "node:path";

const READABLE_SYSTEM_ROOTS = [
  "/usr",
  "/bin",
  "/sbin",
  "/opt",
  "/Library",
  "/System",
  "/dev",
  "/private/etc",
];

// Toolchain caches/installs under $HOME that validation commands legitimately
// read (mise-managed runtimes, the Bun/Cargo/npm/Go stores). Scoped to the
// SPECIFIC tool directories — NOT the whole ~/.cache or ~/Library/Caches, which
// hold arbitrary application caches a model-controlled `rg` could read and echo
// back. Home is otherwise NOT readable, so ~/.aws, ~/.ssh, ~/.config/gh, and a
// stray ~/.env outside the worktree stay denied.
const READABLE_HOME_SUBPATHS = [
  ".local/share/mise",
  ".local/state/mise",
  ".bun",
  ".cargo",
  ".rustup",
  ".mise",
  ".config/mise",
  ".cache/mise",
  ".npm",
  "go",
  ".cache/go-build",
  "Library/Caches/go-build",
];

// The ONLY $HOME subpaths setup commands may WRITE to. Deliberately narrower
// than the readable toolchain set: setup reads every toolchain store (so `mise`
// and `bun` can resolve already-installed runtimes and modules) but may only
// write to CACHE/state dirs, never to a toolchain's binary/install directory
// (`~/.bun/bin`, `~/.cargo/bin`, `~/.local/share/mise/installs/*/bin`, …). That
// closes a persistence vector: a malicious PR lifecycle/generation script could
// otherwise replace a toolchain binary the operator later runs OUTSIDE the
// sandbox with normal credentials.
//
// `bun install --frozen-lockfile` writes only its module cache; `mise` reads
// (not writes) already-installed runtimes. Setup grants invocation-scoped trust
// to the exact worktree config through its environment, with paranoid mode
// disabling inherited/cross-worktree trust; it never persists a trust decision.
// `mise install` for a NOT-yet-installed pinned runtime would need to write the
// install dir and thus fails fast here — an acceptable, documented trade-off:
// the fleet runs on the operator's machine where the pinned toolchain is already
// present, and adding a new global runtime is an operator action, not something
// a PR's setup should perform unattended.
const SETUP_WRITABLE_HOME_SUBPATHS = [
  ".bun/install/cache",
  ".cache/mise",
  ".local/state/mise",
];

// Environment variables whose names look credential-bearing. They are stripped
// from a worker command's environment so a subprocess cannot echo them back
// through tool output (subprocesses inherit the parent environment).
const SECRET_ENV_PATTERN =
  /token|secret|key|password|passwd|credential|cookie|session|auth|npm_|aws_|gh_|github_|openai|anthropic|azure/i;

export function sandboxProfile(worktree: string): string {
  if (worktree.includes('"')) {
    throw new Error("Worktree path cannot contain a double quote");
  }
  // Reads are denied by default and re-allowed only for the assigned worktree,
  // known system/toolchain roots, and toolchain caches under $HOME — so a
  // model-controlled command cannot read arbitrary host files (e.g.
  // `rg PRIVATE_KEY ~/.aws`, `cat ~/.ssh/id_rsa`, or an `.env` outside the
  // worktree) and echo them back through tool output.
  const reads = [`(allow file-read* (subpath "${worktree}"))`];
  for (const root of READABLE_SYSTEM_ROOTS) {
    reads.push(`(allow file-read* (subpath "${root}"))`);
  }
  reads.push('(allow file-read* (literal "/"))');
  const home = Bun.env["HOME"];
  if (home !== undefined && home.length > 0 && !home.includes('"')) {
    for (const subpath of READABLE_HOME_SUBPATHS) {
      reads.push(`(allow file-read* (subpath "${home}/${subpath}"))`);
    }
  }
  // The process's OWN temp dir (usually under /private/var/folders) — tools
  // write and read intermediate files there. Scoped to TMPDIR only, so other
  // apps' cache data under /private/var/folders stays unreadable.
  const tmpdir = Bun.env["TMPDIR"];
  if (tmpdir !== undefined && tmpdir.length > 0 && !tmpdir.includes('"')) {
    reads.push(`(allow file-read* (subpath "${tmpdir}"))`);
  }
  return `(version 1)
(deny default)
(allow process*)
(allow sysctl-read)
${reads.join("\n")}
(allow file-write* (subpath "${worktree}"))
(allow file-write* (subpath "/private/tmp"))
(allow file-write* (subpath "/private/var/folders"))
(deny network*)`;
}

function assertNoQuote(label: string, value: string): void {
  if (value.includes('"')) {
    throw new Error(`${label} cannot contain a double quote`);
  }
}

// The directories `setup_worktree` needs to reason about. A linked worktree's
// `.git` is a FILE pointing at `<checkout>/.git/worktrees/<name>`, with the
// shared hook/config store under `<checkout>/.git`; and the fleet worktrees are
// nested inside the checkout, which is what turbo resolves the workspace root
// to. All three live outside the worktree tree, so the setup profile must name
// them explicitly.
export type SetupDirectories = {
  gitCommonDir: string;
  gitDir: string;
  // The main checkout root that contains the fleet worktrees (nested under
  // `<checkoutRoot>/.claude/worktrees/...`). Turbo resolves the workspace root
  // to this outer checkout and reads/writes its cache (`<root>/.turbo`,
  // `<root>/node_modules/.cache`) there.
  checkoutRoot: string;
};

// System mach services a dependency install legitimately needs: DNS resolution
// (mDNSResponder), name/user lookups (opendirectoryd libinfo), and the trust
// evaluation used for TLS certificate validation (trustd). The keychain agents
// (securityd/SecurityServer) are deliberately OMITTED so a PR script cannot pull
// stored keychain secrets, and network is allowed regardless.
const SETUP_MACH_SERVICES = [
  "com.apple.mDNSResponder",
  "com.apple.system.opendirectoryd.libinfo",
  "com.apple.system.notification_center",
  "com.apple.trustd",
  "com.apple.trustd.agent",
];

// System locations that hold secrets but are NOT the operator's own credential
// stores: the local-account password-hash database. Denied explicitly because
// the setup profile otherwise allows broad system reads (see below); the
// operator's GitHub/Buildkite/cloud/model credentials all live under $HOME,
// which is denied wholesale.
const SETUP_DENIED_SYSTEM_SUBPATHS = ["/private/var/db/dslocal"];

// Read allowances for every ancestor DIRECTORY of the worktree, as `literal`
// (this exact path) rather than `subpath` (this path and everything under it).
// Because the worktree lives UNDER the denied $HOME, tools that resolve the cwd
// or walk toward the repo root — `git` (path canonicalization), `turbo` and
// `bunx` (`getcwd`/root discovery) — must stat and list each ancestor or fail
// (`fatal: Invalid path '/Users/<user>'`, `CouldntReadCurrentDirectory`). A
// `literal` allow re-exposes only the directory node itself (its entry names),
// never the file CONTENTS beneath it: `~/.aws/credentials` and every other file
// under $HOME stays governed by the wholesale `deny file-read* (subpath $HOME)`.
function ancestorReads(worktree: string): string[] {
  const parts = worktree.split("/").filter((part) => part.length > 0);
  const reads: string[] = [];
  let prefix = "";
  // Exclude the worktree itself (it gets full file-read* subpath below).
  for (const part of parts.slice(0, -1)) {
    prefix += `/${part}`;
    reads.push(`(allow file-read* (literal "${prefix}"))`);
  }
  return reads;
}

// Sandbox policy for `setup_worktree`, which runs PR-controlled dependency and
// generation scripts (`mise install`, `bun install`, `turbo run generate`).
// Unlike the validation profile — whose command stdout is
// returned to the model, forcing a strict deny-by-default read allowlist —
// setup output is NOT surfaced to the model; its threat is a PR script reading
// the operator's credentials and exfiltrating them over the network it
// legitimately needs. Every such credential lives in an environment variable
// (removed by `setupEnvironment()`) or a file under $HOME (`~/.aws`, `~/.ssh`,
// `~/.config/gh`, `~/.netrc`, dotfiles). So this profile reads broadly (the
// system toolchain, DNS/TLS, Xcode-hosted `git` all just work) but DENIES all
// of $HOME plus the local password-hash store, re-allowing only the toolchain
// caches, the checkout/worktree, the worktree's git directories, and
// metadata/listing of the worktree's ancestors. Writes are confined to the
// worktree, turbo caches at the checkout root, invocation-scoped temp storage,
// and narrow toolchain caches under $HOME. Setup does not install hooks or
// mutate shared Git metadata.
export function setupSandboxProfile(
  worktree: string,
  directories: SetupDirectories,
): string {
  assertNoQuote("Worktree path", worktree);
  assertNoQuote("Git common dir", directories.gitCommonDir);
  assertNoQuote("Git dir", directories.gitDir);
  assertNoQuote("Checkout root", directories.checkoutRoot);
  const home = Bun.env["HOME"];
  const homeUsable =
    home !== undefined && home.length > 0 && !home.includes('"');

  // Broad reads, then carve out the operator's $HOME and the system password
  // store, then re-allow the toolchain caches, the checkout/worktree, the git
  // dirs, and the ancestor directory nodes. Last matching rule wins.
  const reads = ["(allow file-read*)"];
  for (const denied of SETUP_DENIED_SYSTEM_SUBPATHS) {
    reads.push(`(deny file-read* (subpath "${denied}"))`);
  }
  if (homeUsable) {
    reads.push(`(deny file-read* (subpath "${home}"))`);
    for (const subpath of READABLE_HOME_SUBPATHS) {
      reads.push(`(allow file-read* (subpath "${home}/${subpath}"))`);
    }
  }
  // The main checkout (the repository) — turbo resolves the workspace root to it
  // and reads the whole tree to hash inputs, run tasks, and check its cache.
  // This is the code repository, not a credential store. The worktree and git
  // dirs are re-allowed explicitly too, for the case where an operator points
  // --worktree-root outside the checkout.
  reads.push(`(allow file-read* (subpath "${directories.checkoutRoot}"))`);
  reads.push(`(allow file-read* (subpath "${worktree}"))`);
  reads.push(`(allow file-read* (subpath "${directories.gitCommonDir}"))`);
  reads.push(`(allow file-read* (subpath "${directories.gitDir}"))`);
  reads.push(...ancestorReads(worktree));

  const writes = [
    `(allow file-write* (subpath "${worktree}"))`,
    // Turbo's cache lives at the outer checkout root (the worktrees are nested
    // inside it). Scoped to the cache dirs so a PR script cannot rewrite the
    // operator's main-checkout source.
    `(allow file-write* (subpath "${directories.checkoutRoot}/.turbo"))`,
    `(allow file-write* (subpath "${directories.checkoutRoot}/node_modules/.cache"))`,
    '(allow file-write* (subpath "/private/tmp"))',
    '(allow file-write* (subpath "/private/var/folders"))',
    // Device nodes: git, curl, and node all open /dev/null (and /dev/tty,
    // /dev/random) for writing. These are not exfiltration targets for an
    // unprivileged process.
    '(allow file-write* (subpath "/dev"))',
  ];
  if (homeUsable) {
    for (const subpath of SETUP_WRITABLE_HOME_SUBPATHS) {
      writes.push(`(allow file-write* (subpath "${home}/${subpath}"))`);
    }
  }
  const tmpdir = Bun.env["TMPDIR"];
  if (tmpdir !== undefined && tmpdir.length > 0 && !tmpdir.includes('"')) {
    writes.push(`(allow file-write* (subpath "${tmpdir}"))`);
  }
  const machLookups = SETUP_MACH_SERVICES.map(
    (service) => `(global-name "${service}")`,
  ).join(" ");
  return `(version 1)
(deny default)
(allow process*)
(allow sysctl-read)
(allow network*)
(allow system-socket)
(allow mach-lookup ${machLookups})
${reads.join("\n")}
${writes.join("\n")}`;
}

// Strip credential-bearing env vars from a subprocess environment. The name
// heuristic catches conventional credential vars, but a controller can be
// configured with an arbitrarily-named key var (`--api-key-env LLM_ACCESS`);
// that configured name is passed via `extraSecretNames` so it is ALWAYS removed
// even when it does not match the heuristic — otherwise the model credential
// would leak into validation and setup subprocess environments.
export function sanitizedEnvironment(
  extraSecretNames: readonly string[] = [],
): Record<string, string | undefined> {
  const explicit = new Set(extraSecretNames);
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (SECRET_ENV_PATTERN.test(key) || explicit.has(key)) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

// Environment for `setup_worktree` commands: credential env vars scrubbed, plus
// the operator's global/system git config neutralized. Setup runs `git` (via
// turbo's content hashing) but performs no commits, so it
// needs no user identity; pointing the global/system config at /dev/null stops
// git from chasing machine-specific config `include`s under the sandbox-denied
// $HOME.
export function setupEnvironment(
  extraSecretNames: readonly string[],
  miseConfigPath: string,
  miseScratchDirectory: string,
): Record<string, string | undefined> {
  const environment = sanitizedEnvironment(extraSecretNames);
  // Bun.spawn changes the process cwd but preserves an explicitly supplied
  // PWD. Sanitized controller environments therefore need this reset or Bun
  // package scripts can resolve the controller checkout instead of the assigned
  // worktree and hit the sandbox boundary.
  environment["PWD"] = path.dirname(miseConfigPath);
  delete environment["OLDPWD"];
  environment["GIT_CONFIG_GLOBAL"] = "/dev/null";
  environment["GIT_CONFIG_SYSTEM"] = "/dev/null";
  // The setup command intentionally evaluates this PR's tool configuration
  // inside the credential-scrubbed sandbox. Trust exactly that file for this
  // subprocess tree, while paranoid mode disables persisted and repository-wide
  // worktree trust. No `mise trust` mutation reaches the operator's machine.
  environment["MISE_PARANOID"] = "1";
  environment["MISE_TRUSTED_CONFIG_PATHS"] = miseConfigPath;
  // Mise may refresh caches and rebuild shims even when every pinned tool is
  // already installed. Redirect those writes into an invocation-owned temp
  // directory while leaving MISE_DATA_DIR unchanged so installed runtimes stay
  // readable but immutable to PR-controlled setup.
  environment["MISE_CACHE_DIR"] = `${miseScratchDirectory}/cache`;
  environment["MISE_STATE_DIR"] = `${miseScratchDirectory}/state`;
  environment["MISE_SHIMS_DIR"] = `${miseScratchDirectory}/shims`;
  // Prisma writes downloaded engine metadata beneath XDG_CACHE_HOME. Keep that
  // cache invocation-scoped too: setup may populate it without granting a
  // PR-controlled script write access to the operator's persistent ~/.cache.
  environment["XDG_CACHE_HOME"] = `${miseScratchDirectory}/xdg-cache`;
  return environment;
}
