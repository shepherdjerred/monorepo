package com.shepherdjerred.thestorm.towns.domain.town;

import com.shepherdjerred.thestorm.towns.domain.protection.TrustLevel;

/** A member's role in their town. */
public enum TownRole {
  /** Founded or inherited the town; may delete it. Exactly one per town. */
  OWNER,
  /** Helps run the town: may claim, unclaim and set flags. */
  ASSISTANT,
  /** Lives in the town and builds on its land. */
  MEMBER;

  /** How far the town's land trusts someone with this role. */
  public TrustLevel trust() {
    return switch (this) {
      case OWNER -> TrustLevel.OWNER;
      case ASSISTANT, MEMBER -> TrustLevel.TRUSTED;
    };
  }

  /** True when this role may claim, unclaim and change claim flags. */
  public boolean managesClaims() {
    return switch (this) {
      case OWNER, ASSISTANT -> true;
      case MEMBER -> false;
    };
  }
}
