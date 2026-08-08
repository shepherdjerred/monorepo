import { projectDisplayName, projectPath } from "tasknotes-types/v2";

export type ProjectOption = {
  /** Exact project value written back to TaskNotes. */
  readonly identity: string;
  /** Canonical vault path used to distinguish same-named projects. */
  readonly path: string;
  /** Compact human-facing name. */
  readonly label: string;
};

export function canonicalProjectKey(identity: string): string {
  return projectPath(identity).toLowerCase();
}

export function createProjectOption(identity: string): ProjectOption {
  return {
    identity,
    path: projectPath(identity),
    label: projectDisplayName(identity),
  };
}

export function deriveProjectOptions(
  projectIdentities: readonly string[],
): readonly ProjectOption[] {
  const byIdentity = new Map<string, ProjectOption>();
  for (const identity of projectIdentities) {
    const key = canonicalProjectKey(identity);
    if (!byIdentity.has(key)) {
      byIdentity.set(key, createProjectOption(identity));
    }
  }

  return [...byIdentity.values()].sort(
    (left, right) =>
      left.label.localeCompare(right.label) ||
      left.path.localeCompare(right.path),
  );
}

export function projectOptionLabel(
  option: ProjectOption,
  options: readonly ProjectOption[],
): string {
  const ambiguous = options.some(
    (candidate) =>
      canonicalProjectKey(candidate.identity) !==
        canonicalProjectKey(option.identity) &&
      candidate.label.localeCompare(option.label, undefined, {
        sensitivity: "accent",
      }) === 0,
  );
  return ambiguous ? option.path : option.label;
}

export function projectIdentityLabel(
  identity: string,
  options: readonly ProjectOption[],
): string {
  const key = canonicalProjectKey(identity);
  const option = options.find(
    (candidate) => canonicalProjectKey(candidate.identity) === key,
  );
  if (option === undefined) {
    throw new Error(`Project option is missing for identity: ${identity}`);
  }
  return projectOptionLabel(option, options);
}
