package com.shepherdjerred.thestorm.rwf.domain.kit;

/**
 * How involved a kit is to play, shown in the kit menu and used by the weekly rotation, which
 * offers one or two {@link #BASIC} kits and fills the rest with {@link #MID} and {@link #ADVANCED}
 * ones.
 */
public enum KitTier {
  /** Plain gear or a single passive trick. */
  BASIC,
  /** An ability that changes how a fight or the bombs play. */
  MID,
  /** An ability that takes practice to use well. */
  ADVANCED;

  /** The name shown in the menu. */
  public String displayName() {
    return switch (this) {
      case BASIC -> "Basic";
      case MID -> "Mid";
      case ADVANCED -> "Advanced";
    };
  }
}
