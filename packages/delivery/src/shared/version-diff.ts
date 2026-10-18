import type { VersionSetRevision } from "./contract.ts";

export function compareVersions(
  from: VersionSetRevision | null,
  to: VersionSetRevision,
) {
  const components = [
    ...new Set([
      ...Object.keys(from?.components ?? {}),
      ...Object.keys(to.components),
    ]),
  ].sort();
  return components.flatMap((component) => {
    const before = from?.components[component] ?? null;
    const after = to.components[component] ?? null;
    return before?.id === after?.id ? [] : [{ component, before, after }];
  });
}
