export function validateVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Unexpected Data Dragon version format: ${version}`);
  }
}

export function branchName(version: string, id: string): string {
  return `chore/scout-data-dragon-${version}-${id.slice(0, 8)}`;
}

export function failureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("GH_TOKEN")) {
    return "missing-gh-token";
  }
  if (message.includes("gh pr create")) {
    return "pr-create-failed";
  }
  if (message.includes("gh pr merge")) {
    return "pr-merge-failed";
  }
  if (message.includes("git push")) {
    return "git-push-failed";
  }
  if (message.includes("update-data-dragon")) {
    return "updater-failed";
  }
  if (message.includes("bun install")) {
    return "install-failed";
  }
  if (message.includes("Postal") || message.includes("email configuration")) {
    return "email-failed";
  }
  return "exception";
}
