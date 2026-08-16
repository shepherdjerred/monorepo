/**
 * Parsing a Buildkite step's shell command: which env names it assigns, where
 * those assignments are in force, and which repository scripts it invokes.
 *
 * Split out of check-ci-env.ts, which sits at the repo's max-lines cap (the
 * same pattern as metrics-glitter.ts for metrics.ts).
 */

/**
 * Names a shell command assigns before/while running something, which the
 * secret does not carry. Steps routinely rename a secret key into the name a
 * script expects — `export AWS_ACCESS_KEY_ID="$$SEAWEEDFS_ACCESS_KEY_ID"`,
 * `export ARGOCD_TOKEN="$$ARGOCD_AUTH_TOKEN"`. Treating those as unprovided
 * would make this check's first run a wall of false positives.
 *
 * Handles several assignments per `export` (the pipeline exports the two AWS
 * names on one line) and bare `NAME=value cmd` prefixes.
 */
export function assignedEnvNames(command: string): Set<string> {
  const names = new Set<string>();
  for (const scope of commandScopes(command)) {
    for (const name of scope.assigned) names.add(name);
  }
  return names;
}

export type CommandScope = {
  /** Names assigned at or above this scope, so visible to its invocations. */
  assigned: Set<string>;
  /** Script paths invoked while those assignments are in effect. */
  scripts: string[];
};

const ASSIGNMENT = /(?<![\w$])([A-Z_][A-Z0-9_]*)=/gu;

/**
 * Split a step's command into subshell scopes.
 *
 * `pr-dryrun` exports the AWS credentials inside `( … )` around its Tofu loop
 * and then runs other scripts outside it. Treating the command as one flat
 * scope reports those names as provided to every script in the step — a false
 * negative in exactly the direction this check exists to prevent, since it
 * would let a genuinely missing credential pass.
 *
 * Only `( … )` is modelled. `{ …; }` shares the parent's environment, so it
 * needs no scope of its own, and the pipeline uses no other construct that
 * scopes exports.
 */
export function commandScopes(command: string): CommandScope[] {
  const root: CommandScope = { assigned: new Set(), scripts: [] };
  const scopes: CommandScope[] = [root];
  const stack: CommandScope[] = [root];
  const innermost = (): CommandScope => stack.at(-1) ?? root;
  for (const line of command.split("\n")) {
    const trimmed = line.trim();
    // A line that opens a subshell starts a scope inheriting what is in force.
    for (const _ of trimmed.matchAll(/\(/gu)) {
      const child: CommandScope = {
        assigned: new Set(innermost().assigned),
        scripts: [],
      };
      stack.push(child);
      scopes.push(child);
    }
    const current = innermost();
    if (/(?:^|\s|;)(?:export\s|[A-Z_][A-Z0-9_]*=)/u.test(trimmed)) {
      for (const match of trimmed.matchAll(ASSIGNMENT)) {
        const name = match[1];
        if (name !== undefined) current.assigned.add(name);
      }
    }
    current.scripts.push(...scriptPathsInCommand(trimmed));
    for (const _ of trimmed.matchAll(/\)/gu)) {
      if (stack.length > 1) stack.pop();
    }
  }
  return scopes;
}

/** Repo-relative `.ts`/`.sh` script paths written literally in a command. */
export function scriptPathsInCommand(command: string): string[] {
  const paths = new Set<string>();
  const pattern =
    /(?<![\w./-])((?:scripts|\.buildkite\/scripts|packages\/[\w.-]+(?:\/[\w.-]+)*?\/scripts)\/[\w.-]+\.ts)/gu;
  for (const match of command.matchAll(pattern)) {
    const found = match[1];
    if (found !== undefined) paths.add(found);
  }
  return [...paths].toSorted();
}
