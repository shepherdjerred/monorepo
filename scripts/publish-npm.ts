#!/usr/bin/env bun
/**
 * Publish an npm package via `bun publish`.
 *
 * Ported from the old CI's `publishNpmHelper` (.dagger/src/release.ts). Runs
 * locally: given a package directory, it verifies NPM_TOKEN bypasses 2FA (the
 * token-introspection preflight below) and then publishes from that dir.
 *
 * Usage:
 *   bun scripts/publish-npm.ts <package-dir> [--tag latest|dev] [--dev-suffix <n>] [--dry-run]
 *
 * Env:
 *   NPM_TOKEN — an npm granular token with bypass-2FA enabled (required unless --dry-run)
 *
 * Modes:
 * - Prod (default, no --dev-suffix): publishes the package.json version with --tag latest
 * - Dev (--dev-suffix <n>): appends -dev.<n> to the version, publishes with --tag dev
 *
 * The old helper rewrote `file:` workspace deps to real versions before
 * publishing. This repo uses `workspace:*` protocol deps instead, which `bun
 * publish` resolves to the concrete published version automatically — so no
 * manual rewrite is needed here.
 */

import { run, requireEnv } from "./lib/run.ts";
import { asRecord } from "./lib/json.ts";

// ---------------------------------------------------------------------------
// npm token 2FA-bypass preflight (ported faithfully from publishNpmHelper)
// ---------------------------------------------------------------------------

/**
 * Does this token entry (from /-/npm/v1/tokens) correspond to `token`? The
 * registry masks tokens as `<prefix>...<suffix>`; a match means the live token
 * both starts with the prefix and ends with the suffix.
 */
function entryMatchesToken(
  entry: Record<string, unknown>,
  token: string,
): boolean {
  const masked = entry["token"];
  if (typeof masked !== "string") {
    return false;
  }
  const parts = masked.split("...");
  if (parts.length !== 2) {
    return false;
  }
  const [pre, suf] = parts;
  return (
    pre !== undefined &&
    suf !== undefined &&
    token.startsWith(pre) &&
    token.endsWith(suf)
  );
}

/**
 * Precheck: if NPM_TOKEN doesn't bypass 2FA, `bun publish` silently falls into
 * npm's interactive web-auth flow and hangs ~5 minutes. Detect this up-front
 * via /-/npm/v1/tokens (paginated; some accounts have dozens of tokens) and
 * fail fast with an actionable message before bun gets a chance to wait.
 */
async function verifyTokenBypasses2fa(token: string): Promise<void> {
  let url: string | null = "https://registry.npmjs.org/-/npm/v1/tokens";
  let me: Record<string, unknown> | null = null;
  let pages = 0;
  while (url !== null && me === null) {
    pages++;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      throw new Error(
        `npm token introspection failed (page ${pages.toString()}): ` +
          `HTTP ${r.status.toString()} ${r.statusText}`,
      );
    }
    const data = asRecord(await r.json());
    if (data === null) {
      throw new Error("npm token introspection returned a non-object body");
    }
    const objects = data["objects"];
    if (Array.isArray(objects)) {
      for (const o of objects) {
        const entry = asRecord(o);
        if (entry !== null && entryMatchesToken(entry, token)) {
          me = entry;
          break;
        }
      }
    }
    // Advance to the next page if the registry paginated the response.
    const urls = asRecord(data["urls"]);
    const next = urls === null ? undefined : urls["next"];
    if (typeof next === "string" && next !== "") {
      url = next.startsWith("http")
        ? next
        : `https://registry.npmjs.org${next}`;
    } else {
      url = null;
    }
  }

  if (me === null) {
    throw new Error(
      `Current NPM_TOKEN not found across ${pages.toString()} page(s) of ` +
        `/-/npm/v1/tokens — token may be revoked, or the registry ` +
        `truncated/changed its response shape`,
    );
  }
  if (me["bypass_2fa"] !== true) {
    throw new Error(
      "ERROR: NPM_TOKEN does not bypass 2FA. bun publish will hang on npm " +
        "interactive web-auth fallback. Rotate to a granular token with " +
        "bypass-2FA enabled: sign in to npmjs.com with a WebAuthn passkey in " +
        "the same session (TOTP alone leaves the bypass-2FA checkbox disabled " +
        "per npm policy since 2026-05), then mint at " +
        "https://www.npmjs.com/settings/<user>/tokens/new. Classic Automation " +
        "tokens were retired by npm in 2025.",
    );
  }
  const name = typeof me["name"] === "string" ? me["name"] : "(unnamed)";
  console.log(
    `OK: NPM_TOKEN bypasses 2FA (token name: ${name}, found on page ${pages.toString()})`,
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage(): never {
  console.error(
    "Usage: bun scripts/publish-npm.ts <package-dir> [--tag latest|dev] " +
      "[--dev-suffix <n>] [--dry-run]",
  );
  process.exit(1);
}

function parseArgs(argv: string[]): {
  pkgDir: string;
  tag: "latest" | "dev";
  devSuffix: string;
  dryRun: boolean;
} {
  if (argv.includes("--help") || argv.includes("-h")) {
    usage();
  }
  let pkgDir: string | undefined;
  let tag: "latest" | "dev" | undefined;
  let devSuffix = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (a === "--tag") {
      const v = argv[++i];
      if (v !== "latest" && v !== "dev") {
        console.error(`--tag must be "latest" or "dev", got: ${String(v)}`);
        usage();
      }
      tag = v;
      continue;
    }
    if (a === "--dev-suffix") {
      const v = argv[++i];
      if (v === undefined) {
        usage();
      }
      devSuffix = v;
      continue;
    }
    if (a?.startsWith("--")) {
      console.error(`Unknown flag: ${a}`);
      usage();
    }
    if (a !== undefined) {
      if (pkgDir !== undefined) {
        console.error("Only one package dir may be given");
        usage();
      }
      pkgDir = a;
    }
  }
  if (pkgDir === undefined) {
    console.error("A package directory is required");
    usage();
  }
  // Dev-suffix implies the dev tag unless the operator overrode it explicitly.
  const resolvedTag = tag ?? (devSuffix === "" ? "latest" : "dev");
  return { pkgDir, tag: resolvedTag, devSuffix, dryRun };
}

async function main(): Promise<void> {
  const { pkgDir, tag, devSuffix, dryRun } = parseArgs(Bun.argv.slice(2));

  const pkgJsonPath = `${pkgDir}/package.json`;
  const pkgFile = Bun.file(pkgJsonPath);
  if (!(await pkgFile.exists())) {
    throw new Error(`No package.json at ${pkgJsonPath}`);
  }
  const pkgJson = asRecord(await pkgFile.json());
  if (pkgJson === null || typeof pkgJson["name"] !== "string") {
    throw new Error(`${pkgJsonPath} has no string "name"`);
  }
  const pkgName = pkgJson["name"];
  const baseVersion =
    typeof pkgJson["version"] === "string" ? pkgJson["version"] : "0.0.0";

  console.log(`--- Publish ${pkgName} (${pkgDir}) --tag ${tag}`);

  // For dev releases, append -dev.<suffix> to package.json (ephemeral; the
  // original text is restored in the finally below, so a failed or retried
  // publish can never leave the -dev.N version behind for a later prod
  // publish to pick up and push under --tag latest).
  let originalPkgJsonText: string | null = null;
  if (devSuffix !== "") {
    originalPkgJsonText = await pkgFile.text();
    pkgJson["version"] = `${baseVersion}-dev.${devSuffix}`;
    await Bun.write(pkgJsonPath, JSON.stringify(pkgJson, null, 2) + "\n");
    console.log(
      `dev version: ${baseVersion} -> ${baseVersion}-dev.${devSuffix}`,
    );
  }

  try {
    // Build from source before publishing (matches the old helper).
    console.log("+++ build");
    if (dryRun) {
      console.log(
        `DRYRUN: would run \`bun --no-install run build\` in ${pkgDir}`,
      );
    } else {
      await run(["bun", "--no-install", "run", "build"], { cwd: pkgDir });
    }

    if (dryRun) {
      console.log(
        `DRYRUN: would verify NPM_TOKEN bypasses 2FA, then ` +
          `\`bun publish --access public --tag ${tag} --tolerate-republish\``,
      );
      return;
    }

    const token = requireEnv("NPM_TOKEN");
    await verifyTokenBypasses2fa(token);

    // bun publish reads the token from the NPM_TOKEN env var via a static
    // `.npmrc` whose value is a literal `${NPM_TOKEN}` — bun substitutes it at
    // parse time so the secret bytes never land on disk. This avoids the
    // "must not write tokens to files" rule. Must be written at the WORKSPACE
    // ROOT: in a workspace, bun resolves .npmrc from the project root (where
    // bun.lock lives) and ignores one in the package dir ("missing
    // authentication", main build 5633).
    const npmrcPath = `${import.meta.dir}/../.npmrc`;
    await Bun.write(
      npmrcPath,
      "//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n",
    );
    try {
      await run(
        [
          "bun",
          "publish",
          "--access",
          "public",
          "--tag",
          tag,
          "--tolerate-republish",
        ],
        { cwd: pkgDir, env: { NPM_TOKEN: token } },
      );
    } finally {
      // Remove the .npmrc so it never lingers in a working tree.
      await Bun.file(npmrcPath)
        .exists()
        .then((exists) =>
          exists ? Bun.$`rm ${npmrcPath}`.quiet() : undefined,
        );
    }
  } finally {
    // Restore the pre-dev-rewrite package.json (see above).
    if (originalPkgJsonText !== null) {
      await Bun.write(pkgJsonPath, originalPkgJsonText);
    }
  }

  console.log(`--- published ${pkgName} --tag ${tag}`);
}

await main();
