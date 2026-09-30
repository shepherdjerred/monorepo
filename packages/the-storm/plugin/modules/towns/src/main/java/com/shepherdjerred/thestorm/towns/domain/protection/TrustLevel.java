package com.shepherdjerred.thestorm.towns.domain.protection;

/** How far a town trusts a player on its land. */
public enum TrustLevel {
  /** Runs the town: may do anything on its land. */
  OWNER,
  /** A member: may do anything on the town's land except what flags forbid everyone. */
  TRUSTED,
  /** Anyone else: limited to what the claim's public flags allow. */
  OUTSIDER,
}
