package com.shepherdjerred.thestorm.essentials.domain.teleport;

/**
 * What a teleport costs right now, and the usage to record once it is paid.
 *
 * @param kind the teleport kind
 * @param cost crystals to charge; zero means free
 * @param multiplier the multiplier applied to the base price
 * @param next the usage to store after the teleport happens
 */
public record Quote(TeleportKind kind, long cost, Multiplier multiplier, TeleportUsage next) {

  public Quote {
    if (cost < 0) {
      throw new IllegalArgumentException("cost must not be negative: " + cost);
    }
  }
}
