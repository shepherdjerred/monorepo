#!/usr/bin/env bun
/**
 * Assert every dependency spec in the workspace resolves DETERMINISTICALLY,
 * so a commit that touches no manifest can never change what `bun install`
 * resolves.
 *
 * The failure this prevents: a spec like `"bun-types": "latest"` names a
 * mutable npm dist-tag, not a version. bun re-resolves the tag on every
 * install, so the moment the registry moves `latest`, the committed
 * bun.lock disagrees with the manifests and EVERY `bun install
 * --frozen-lockfile` in CI fails — on `main`, with no change to blame. That
 * is exactly how bun-types@1.4.0 reddened main: `verify` and
 * `playwright-e2e-main` both died in the install step before running a
 * single check.
 *
 * Dist-tags are also invisible to Renovate, so those deps drift outside the
 * reviewed-bump workflow every other dependency goes through.
 *
 * Scope is the root manifest plus its workspace members — precisely the set
 * that feeds the root bun.lock. sandbox/ is deliberately excluded: it is not
 * a workspace, so its manifests never reach the lockfile.
 */
import path from "node:path";

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * Protocols whose target is pinned by the checkout itself rather than by
 * registry resolution. `npm:` is absent on purpose: an alias carries its own
 * nested spec (`npm:typescript@7.0.2`), which is unwrapped and re-checked.
 */
const pinnedProtocols = ["workspace:", "file:", "link:"];

export type SpecVerdict = { ok: true } | { ok: false; reason: string };

/**
 * A spec is accepted only when a lockfile can pin it. Rather than enumerate
 * tag names (`latest`, `next`, `canary`, … — an open set), this rejects
 * anything that is not a version-anchored range or a pinned protocol, so a
 * newly invented tag is caught too.
 */
export function classifySpec(rawSpec: string): SpecVerdict {
  const spec = rawSpec.trim();

  if (spec === "") {
    return {
      ok: false,
      reason: "empty spec resolves to any published version",
    };
  }

  for (const protocol of pinnedProtocols) {
    if (spec.startsWith(protocol)) return { ok: true };
  }

  if (spec.startsWith("npm:")) {
    const alias = spec.slice("npm:".length);
    // Scoped names carry a leading @, so the separating @ is the last one.
    const at = alias.lastIndexOf("@");
    if (at <= 0) {
      return {
        ok: false,
        reason: `npm: alias "${spec}" names no version — it resolves to the latest publish`,
      };
    }
    const inner = classifySpec(alias.slice(at + 1));
    return inner.ok
      ? { ok: true }
      : {
          ok: false,
          reason: `npm: alias target is not pinned — ${inner.reason}`,
        };
  }

  if (spec === "*" || spec === "x" || spec === "X") {
    return { ok: false, reason: `"${spec}" matches every published version` };
  }

  // Every semver range is anchored on a digit, optionally behind a comparator
  // or a `v` prefix (^1.2, >=2.0.0 <3, 1.x, v1.2.3). Anything else beginning
  // with a letter is a dist-tag; anything else entirely is unsupported.
  if (/^[\s<>=~^]*v?\d/i.test(spec)) return { ok: true };

  if (/^[a-z][\w.-]*$/i.test(spec)) {
    return {
      ok: false,
      reason: `"${spec}" is a mutable npm dist-tag — pin a version range so the lockfile controls resolution`,
    };
  }

  return {
    ok: false,
    reason: `"${spec}" is not a version range or a pinned protocol (${pinnedProtocols.join(", ")}, npm:)`,
  };
}

export function manifestErrors(
  relativePath: string,
  manifestText: string,
): string[] {
  const manifestRaw: unknown = JSON.parse(manifestText);
  if (typeof manifestRaw !== "object" || manifestRaw === null) {
    throw new Error(`${relativePath} must contain an object`);
  }

  const errors: string[] = [];
  for (const field of dependencyFields) {
    const fieldRaw: unknown = Reflect.get(manifestRaw, field);
    if (fieldRaw === undefined) continue;
    if (typeof fieldRaw !== "object" || fieldRaw === null) {
      throw new Error(`${relativePath} ${field} must be an object`);
    }
    for (const [name, specRaw] of Object.entries(fieldRaw)) {
      if (typeof specRaw !== "string") {
        throw new TypeError(
          `${relativePath} ${field}.${name} must be a string`,
        );
      }
      const verdict = classifySpec(specRaw);
      if (!verdict.ok) {
        errors.push(`${relativePath} ${field}.${name}: ${verdict.reason}`);
      }
    }
  }
  return errors;
}

export function readWorkspacePatterns(manifestText: string): string[] {
  const manifestRaw: unknown = JSON.parse(manifestText);
  if (typeof manifestRaw !== "object" || manifestRaw === null) {
    throw new Error("root package.json must contain an object");
  }
  const workspacesRaw: unknown = Reflect.get(manifestRaw, "workspaces");
  if (!Array.isArray(workspacesRaw)) {
    throw new TypeError("root package.json workspaces must be an array");
  }
  return workspacesRaw.map((entry) => {
    if (typeof entry !== "string") {
      throw new TypeError(
        "root package.json workspaces entries must be strings",
      );
    }
    return entry;
  });
}

async function workspaceDirectories(
  root: string,
  patterns: readonly string[],
): Promise<string[]> {
  const directories = new Set<string>();
  for (const pattern of patterns) {
    if (!/[*?[\]{}]/.test(pattern)) {
      directories.add(pattern);
      continue;
    }
    for await (const match of new Bun.Glob(`${pattern}/package.json`).scan({
      cwd: root,
      onlyFiles: true,
    })) {
      directories.add(path.dirname(match));
    }
  }
  return [...directories].sort();
}

export async function collectErrors(root: string): Promise<string[]> {
  const rootManifestText = await Bun.file(`${root}/package.json`).text();
  const errors = [...manifestErrors("package.json", rootManifestText)];

  const directories = await workspaceDirectories(
    root,
    readWorkspacePatterns(rootManifestText),
  );
  for (const directory of directories) {
    const relativePath = `${directory}/package.json`;
    const file = Bun.file(`${root}/${relativePath}`);
    if (!(await file.exists())) {
      // A workspace member listed but absent means the lockfile was built
      // from a different tree than the one being checked.
      errors.push(
        `${relativePath} is listed in root workspaces but does not exist`,
      );
      continue;
    }
    errors.push(...manifestErrors(relativePath, await file.text()));
  }
  return errors;
}

if (import.meta.main) {
  const root = new URL("..", import.meta.url).pathname;
  const errors = await collectErrors(root);
  if (errors.length > 0) {
    console.error("check-floating-deps: FAIL");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  const patterns = readWorkspacePatterns(
    await Bun.file(`${root}/package.json`).text(),
  );
  const directories = await workspaceDirectories(root, patterns);
  const count = directories.length + 1;
  console.log(
    `check-floating-deps: ${String(count)} manifests, every dependency spec is lockfile-pinnable`,
  );
}
