import type { Secret, Directory } from "@dagger.io/dagger";
import { dag } from "@dagger.io/dagger";
import versions from "./lib-versions.ts";
import { runNamedParallel } from "./lib-parallel.ts";
import { getRustContainer } from "./index-infra.ts";

const BUN_VERSION = versions.bun;

/**
 * Run Clauderon Mobile CI: lint, typecheck, format check, test.
 */
export async function runMobileCi(source: Directory): Promise<string> {
  const base = dag
    .container()
    .from(`oven/bun:${BUN_VERSION}-debian`)
    .withMountedCache("/root/.bun/install/cache", dag.cacheVolume("bun-cache"))
    .withWorkdir("/workspace")
    .withDirectory("/workspace", source.directory("packages/clauderon/mobile"))
    .withDirectory(
      "/workspace/src/types/generated",
      source.directory("packages/clauderon/web/shared/src/generated"),
    )
    .withFile("/tsconfig.base.json", source.file("tsconfig.base.json"))
    .withExec(["bun", "install", "--frozen-lockfile"]);

  const results = await runNamedParallel<string>([
    {
      name: "typecheck",
      operation: async () => {
        await base.withExec(["bun", "run", "typecheck"]).sync();
        return "✓ Mobile typecheck passed";
      },
    },
    {
      name: "lint",
      operation: async () => {
        await base.withExec(["bun", "run", "lint"]).sync();
        return "✓ Mobile lint passed";
      },
    },
    {
      name: "format:check",
      operation: async () => {
        await base.withExec(["bun", "run", "format:check"]).sync();
        return "✓ Mobile format:check passed";
      },
    },
    {
      name: "test",
      operation: async () => {
        await base.withExec(["bun", "run", "test"]).sync();
        return "✓ Mobile test passed";
      },
    },
  ]);

  const outputs: string[] = [];
  const errors: string[] = [];
  for (const result of results) {
    if (result.success) {
      outputs.push(String(result.value));
    } else {
      const msg =
        result.error instanceof Error
          ? result.error.message
          : String(result.error);
      outputs.push(`✗ Mobile ${result.name} failed: ${msg}`);
      errors.push(`Mobile ${result.name}: ${msg}`);
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Mobile CI failed:\n${errors.join("\n")}\n\n${outputs.join("\n")}`,
    );
  }

  return outputs.join("\n");
}

/** Run Clauderon CI: fmt check, clippy, test, build. */
export async function runClauderonCi(
  source: Directory,
  frontendDist?: Directory,
  s3AccessKeyId?: Secret,
  s3SecretAccessKey?: Secret,
): Promise<string> {
  const outputs: string[] = [];
  const base = getRustContainer(
    source,
    frontendDist,
    s3AccessKeyId,
    s3SecretAccessKey,
  );

  // Phase 1: Read-only checks in parallel (no target dir writes for fmt/deny)
  const [fmtResult, denyResult] = await Promise.allSettled([
    base.withExec(["cargo", "fmt", "--check"]).sync(),
    base
      .withExec([
        "cargo",
        "install",
        "cargo-deny",
        "--locked",
        "--force",
        "--root",
        "/root/.cargo-tools",
      ])
      .withExec(["cargo", "deny", "check", "advisories", "bans", "sources"])
      .sync(),
  ]);

  if (fmtResult.status === "fulfilled") {
    outputs.push("✓ Format check passed");
  } else {
    const reason: unknown = fmtResult.reason;
    throw reason instanceof Error ? reason : new Error(String(reason));
  }

  if (denyResult.status === "fulfilled") {
    outputs.push("✓ cargo deny passed");
  } else {
    const msg =
      denyResult.reason instanceof Error
        ? denyResult.reason.message
        : String(denyResult.reason);
    outputs.push(`⚠ cargo deny (non-blocking): ${msg}`);
  }

  // Phase 2: Pipeline clippy → test → release build (sequential, reuses compilation artifacts)
  // Single DAG with one sync at end — let Dagger build the full pipeline
  const pipeline = base
    .withExec([
      "cargo",
      "clippy",
      "--all-targets",
      "--all-features",
      "--",
      "-D",
      "warnings",
    ])
    .withExec(["cargo", "test"])
    .withExec(["cargo", "build", "--release"]);
  await pipeline.sync();
  outputs.push("✓ Clippy passed");
  outputs.push("✓ Tests passed");
  outputs.push("✓ Release build succeeded");

  // Phase 3: Coverage (non-blocking, independent)
  try {
    await base
      .withExec([
        "cargo",
        "install",
        "cargo-llvm-cov",
        "--locked",
        "--force",
        "--root",
        "/root/.cargo-tools",
      ])
      .withExec(["cargo", "llvm-cov", "--fail-under-lines", "40"])
      .sync();
    outputs.push("✓ Coverage threshold met");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    outputs.push(`⚠ Coverage (non-blocking): ${msg}`);
  }

  return outputs.join("\n");
}
