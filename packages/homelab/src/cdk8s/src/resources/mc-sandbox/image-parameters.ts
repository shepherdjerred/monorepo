/**
 * Helm parameters (`delivery.images.<name>`) Delivery stamps on each
 * mc-sandbox deployment under transition rendering: the selected tsmc
 * candidate and accepted Storm image references. Dependency-free so the
 * producer's chart validation can name them too.
 */
export const MC_SANDBOX_STORM_IMAGE_PARAMETERS = [
  "the-storm-server-candidate",
  "the-storm-server-accepted",
] as const;
