package com.shepherdjerred.thestorm.rwf.domain.kit;

/** The kind of kit a player wants to browse, independent of its price and complexity. */
public enum KitCategory {
  CLASSIC("Classic"),
  RANGED("Ranged"),
  TACTICAL("Tactical");

  private final String displayName;

  KitCategory(String displayName) {
    this.displayName = displayName;
  }

  public String displayName() {
    return displayName;
  }
}
