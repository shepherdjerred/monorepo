import { docsGroomValidateRejectionsTotal } from "#observability/metrics.ts";
import {
  findOwningPackageDirs,
  isSecretPath,
  parseGitStatus,
  run,
} from "./docs-groom-utils.ts";
import { captureWithContext, jsonLog } from "./docs-groom-impl.ts";

export type ValidateOk = {
  ok: true;
  touchesCode: boolean;
  changedFiles: string[];
};
export type ValidateFail = { ok: false; reason: string };
export type ValidateResult = ValidateOk | ValidateFail;

export type TypecheckResult = { ok: true } | { ok: false; output: string };

export async function doValidateChanges(
  worktreePath: string,
  branch: string,
): Promise<ValidateResult> {
  const branchResult = await run(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: worktreePath,
  });
  const currentBranch = branchResult.stdout.trim();
  if (
    currentBranch === "main" ||
    currentBranch === "master" ||
    currentBranch !== branch
  ) {
    docsGroomValidateRejectionsTotal.inc({ reason: "branch-main" });
    return {
      ok: false,
      reason: `current branch is "${currentBranch}", expected "${branch}"`,
    };
  }

  const status = await run(["git", "status", "--porcelain"], {
    cwd: worktreePath,
  });
  const changedFiles = parseGitStatus(status.stdout);

  if (changedFiles.length === 0) {
    docsGroomValidateRejectionsTotal.inc({ reason: "empty-diff" });
    return { ok: false, reason: "no files changed" };
  }

  const secretMatch = changedFiles.find((p) => isSecretPath(p));
  if (secretMatch !== undefined) {
    docsGroomValidateRejectionsTotal.inc({ reason: "secret" });
    const e = new Error(
      `validateChanges refused: changed path looks like a secret: ${secretMatch}`,
    );
    captureWithContext(e, "validate", { changedFiles, secretMatch });
    jsonLog("error", "Secret pattern in diff", "validate", {
      secretMatch,
      changedFiles,
    });
    return { ok: false, reason: `secret pattern matched: ${secretMatch}` };
  }

  const ignoredCheck = await run(
    ["git", "check-ignore", "--", ...changedFiles],
    { cwd: worktreePath, throwOnError: false },
  );
  if (ignoredCheck.exitCode === 0 && ignoredCheck.stdout.trim().length > 0) {
    docsGroomValidateRejectionsTotal.inc({ reason: "gitignored" });
    return {
      ok: false,
      reason: `gitignored paths in diff: ${ignoredCheck.stdout.trim()}`,
    };
  }

  const touchesCode = changedFiles.some((p) => !p.startsWith("packages/docs/"));
  return { ok: true, touchesCode, changedFiles };
}

export async function doTypecheckIfCodeTouched(
  worktreePath: string,
  changedFiles: string[],
): Promise<TypecheckResult> {
  const codeFiles = changedFiles.filter((p) => !p.startsWith("packages/docs/"));
  if (codeFiles.length === 0) {
    return { ok: true };
  }

  const packageDirs = await findOwningPackageDirs(worktreePath, codeFiles);
  if (packageDirs.size === 0) {
    jsonLog(
      "info",
      "Code files touched but no owning package.json found — skipping typecheck",
      "typecheck",
      { codeFiles },
    );
    return { ok: true };
  }

  for (const pkgDir of packageDirs) {
    jsonLog("info", "Running bun run typecheck", "typecheck", {
      packageDir: pkgDir,
    });
    const result = await run(["bun", "run", "typecheck"], {
      cwd: pkgDir,
      throwOnError: false,
    });
    if (result.exitCode !== 0) {
      docsGroomValidateRejectionsTotal.inc({ reason: "typecheck-failed" });
      return {
        ok: false,
        output:
          `typecheck failed in ${pkgDir} (exit ${String(result.exitCode)}):\n${result.stderr}\n${result.stdout}`.slice(
            0,
            4000,
          ),
      };
    }
  }
  return { ok: true };
}
