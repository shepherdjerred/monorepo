function once(source, before, after) {
  if (source.split(before).length !== 2)
    throw Error("Exact projectile ownership baseline boundary required");
  return source.replace(before, after);
}

// Reproduce the valid-input construction before sharing: the family owned a
// complete source clone and built its own ordinary projectile query index.
// Every query, metadata gate, event and placement calculation stays unchanged.
export function projectileOwnerBaselineSource(source) {
  let baseline = once(
    source,
    "  createOwnedProjectilePresentation,\n",
    "  createProjectilePresentation,\n  createOwnedProjectilePresentation,\n",
  );
  baseline = once(
    baseline,
    "  const projectiles =\n      presentationOwner === null\n        ? createOwnedProjectilePresentation(report, presentation)\n        : presentationOwner,\n    source = readOwnedProjectileMetadata(projectiles, report);",
    "  const source = structuredClone(presentation);\n  const projectiles = createProjectilePresentation(report, source);",
  );
  return baseline;
}
