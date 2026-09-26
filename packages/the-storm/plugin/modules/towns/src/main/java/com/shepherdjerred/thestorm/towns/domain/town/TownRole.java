package com.shepherdjerred.thestorm.towns.domain.town;

import com.shepherdjerred.thestorm.towns.domain.protection.TrustLevel;

/** A member's role in their town. */
public enum TownRole {
  /** Founded or inherited the town; may delete, rename and hand it over, and rank members. */
  OWNER,
  /** Helps run the town: claims land, sets flags, invites, kicks members and withdraws money. */
  ASSISTANT,
  /** Lives in the town, builds on its land and pays into its treasury. */
  MEMBER;

  /** How far the town's land trusts someone with this role. */
  public TrustLevel trust() {
    return switch (this) {
      case OWNER -> TrustLevel.OWNER;
      case ASSISTANT, MEMBER -> TrustLevel.TRUSTED;
    };
  }

  /**
   * True when this role runs the town day to day: claims, unclaims, flags, claim trust, invites,
   * kicks and treasury withdrawals.
   */
  public boolean manages() {
    return switch (this) {
      case OWNER, ASSISTANT -> true;
      case MEMBER -> false;
    };
  }

  /** True when this role may claim, unclaim and change claim flags. */
  public boolean managesClaims() {
    return manages();
  }

  /** True when this role may remove a member holding {@code other}. */
  public boolean outranks(TownRole other) {
    return switch (this) {
      case OWNER -> other != OWNER;
      case ASSISTANT -> other == MEMBER;
      case MEMBER -> false;
    };
  }
}
