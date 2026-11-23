// Null is an explicit producer declaration, not a missing metadata fallback.
export function latestViewerPoseAvailability(previewNames) {
  const unavailableBaseStates = [];
  for (const name of ["idle", "run"]) {
    if (
      !previewNames ||
      !Object.hasOwn(previewNames, name) ||
      (previewNames[name] !== null &&
        (typeof previewNames[name] !== "string" ||
          previewNames[name].length === 0))
    )
      throw Error("Explicit viewer base animation states required");
    if (previewNames[name] === null) unavailableBaseStates.push(name);
  }
  return Object.freeze({
    status: unavailableBaseStates.length ? "unavailable" : "available",
    unavailableBaseStates: Object.freeze(unavailableBaseStates),
  });
}

// All animated-actor visibility writes pass this gate, including later minion
// reconciliation. A loaded skeleton alone must never become a displayed pose.
export function setLatestViewerAnimatedVisibility(entry, requestedVisible) {
  if (typeof requestedVisible !== "boolean" || !entry?.group)
    throw Error("Animated viewer group and explicit visibility required");
  entry.group.visible =
    requestedVisible &&
    latestViewerPoseAvailability(entry.previewNames).status === "available";
  return entry.group.visible;
}
