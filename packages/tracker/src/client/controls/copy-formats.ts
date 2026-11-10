const branchLimit = 60;

/**
 * A git branch for an issue: its identifier and title in lower-case kebab
 * case, cut at a word boundary to at most 60 characters.
 */
export function branchName(identifier: string, title: string) {
  const words = `${identifier} ${title}`
    .normalize("NFKD")
    .replaceAll(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word !== "");
  let branch = "";
  for (const word of words) {
    const next = branch === "" ? word : `${branch}-${word}`;
    if (next.length > branchLimit) {
      break;
    }
    branch = next;
  }
  // A single word longer than the limit is still cut rather than dropped.
  return branch === "" ? (words[0] ?? "").slice(0, branchLimit) : branch;
}

export function issueUrl(origin: string, identifier: string) {
  return `${origin}/issues/${identifier}`;
}

/** Several issues copy as one per line. */
export function joinLines(values: readonly string[]) {
  return values.join("\n");
}
