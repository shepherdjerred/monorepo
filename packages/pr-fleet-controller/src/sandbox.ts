// macOS `sandbox-exec` policy and environment scrubbing for model-driven worker
// validation commands. `run_local_command` arguments are model-controlled and
// its stdout is returned to the remote model, so reads must be confined to the
// assigned worktree plus known toolchain paths (not a deny-list of guessed
// credential locations), and credential-bearing env vars must be stripped.

// System roots the toolchain must read (compilers, shared libraries, CA certs,
// Homebrew under /opt). On macOS /etc, /tmp, and /var resolve under /private,
// which is already covered. Everything else is denied by default, making this
// an allowlist rather than an enumeration of every credential location.
const READABLE_SYSTEM_ROOTS = [
  "/usr",
  "/bin",
  "/sbin",
  "/opt",
  "/Library",
  "/System",
  "/private",
  "/dev",
];

// Toolchain caches/installs under $HOME that validation commands legitimately
// read (mise-managed runtimes, the Bun/Cargo/npm/Go stores). Home is otherwise
// NOT readable, so credential stores like ~/.aws, ~/.ssh, ~/.config/gh, and a
// stray ~/.env outside the worktree stay denied.
const READABLE_HOME_SUBPATHS = [
  ".local",
  ".cache",
  ".bun",
  ".cargo",
  ".rustup",
  ".mise",
  ".config/mise",
  ".npm",
  "go",
  "Library/Caches",
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

export function sanitizedEnvironment(): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(Bun.env)) {
    if (SECRET_ENV_PATTERN.test(key)) {
      continue;
    }
    result[key] = value;
  }
  return result;
}
