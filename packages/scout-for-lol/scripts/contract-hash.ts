#!/usr/bin/env bun
/**
 * Deterministic hash of the sources that define the frontend↔backend tRPC
 * contract. The SPA compiles against the backend's inferred router types, so
 * the client-visible API is fully determined by:
 *
 *   - the tRPC routers + procedure builders (backend src/trpc/router, trpc.ts)
 *   - the @scout-for-lol/data Zod schemas (procedure inputs/outputs)
 *   - the Prisma schema (generated client types leak into inferred outputs)
 *
 * The hash is baked into the backend image (ENV CONTRACT_HASH, via
 * docker-bake.hcl) and into the SPA bundle (VITE_CONTRACT_HASH, via
 * scripts/scout-site-release.ts). Equal hashes ⇒ the two builds share a
 * contract, regardless of their build numbers — the backend image is
 * content-gated, so a healthy release pair routinely carries different
 * version labels. The SPA warns (reload nudge) when the hashes differ.
 *
 * Dependency-free (Bun stdlib only) so it runs under `bun --no-install` in
 * the images step before any workspace install. Test files are excluded —
 * they never shape the contract.
 *
 * Usage: bun --no-install packages/scout-for-lol/scripts/contract-hash.ts
 */

/** Repo root = three levels up (packages/scout-for-lol/scripts/…). */
const repoRoot = new URL("../../..", import.meta.url).pathname.replace(
  /\/$/,
  "",
);

const CONTRACT_GLOBS = [
  "packages/scout-for-lol/packages/backend/src/trpc/router/**/*.ts",
  "packages/scout-for-lol/packages/backend/src/trpc/trpc.ts",
  "packages/scout-for-lol/packages/data/src/**/*.ts",
  "packages/scout-for-lol/packages/backend/prisma/schema.prisma",
];

async function contractHash(): Promise<string> {
  const files = new Set<string>();
  for (const pattern of CONTRACT_GLOBS) {
    for await (const path of new Bun.Glob(pattern).scan({ cwd: repoRoot })) {
      if (path.endsWith(".test.ts")) {
        continue;
      }
      files.add(path);
    }
  }
  if (files.size === 0) {
    throw new Error(
      `contract-hash: no contract files matched under ${repoRoot} — glob roots moved?`,
    );
  }

  const hasher = new Bun.CryptoHasher("sha256");
  for (const path of [...files].sort()) {
    hasher.update(path);
    hasher.update("\0");
    hasher.update(await Bun.file(`${repoRoot}/${path}`).arrayBuffer());
    hasher.update("\0");
  }
  return hasher.digest("hex");
}

console.log(await contractHash());
