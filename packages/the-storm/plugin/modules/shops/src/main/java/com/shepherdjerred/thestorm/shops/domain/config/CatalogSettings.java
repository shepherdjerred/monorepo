package com.shepherdjerred.thestorm.shops.domain.config;

import java.time.DateTimeException;
import java.time.ZoneId;

/**
 * NPC catalog shops.
 *
 * @param dailyResetZone the time zone whose midnight resets daily limits, such as {@code UTC}
 * @param maxLots the most trades of an entry one menu purchase may bundle
 * @param maxDistance how far, in blocks, a player may stand from the shopkeeper and still use the
 *     shop's buttons
 */
public record CatalogSettings(String dailyResetZone, int maxLots, int maxDistance) {

  public CatalogSettings {
    try {
      ZoneId.of(dailyResetZone);
    } catch (DateTimeException e) {
      throw new IllegalArgumentException("dailyResetZone is not a time zone: " + dailyResetZone, e);
    }
    if (maxLots < 1) {
      throw new IllegalArgumentException("maxLots must be positive: " + maxLots);
    }
    if (maxDistance < 1) {
      throw new IllegalArgumentException("maxDistance must be positive: " + maxDistance);
    }
  }

  public ZoneId zone() {
    return ZoneId.of(dailyResetZone);
  }
}
