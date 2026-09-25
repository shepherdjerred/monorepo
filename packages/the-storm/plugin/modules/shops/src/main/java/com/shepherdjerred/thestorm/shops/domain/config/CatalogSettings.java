package com.shepherdjerred.thestorm.shops.domain.config;

import java.time.DateTimeException;
import java.time.ZoneId;

/**
 * NPC catalog shops.
 *
 * @param dailyResetZone the time zone whose midnight resets daily limits, such as {@code UTC}
 * @param maxLots the most trades of an entry one menu purchase may bundle
 */
public record CatalogSettings(String dailyResetZone, int maxLots) {

  public CatalogSettings {
    try {
      ZoneId.of(dailyResetZone);
    } catch (DateTimeException e) {
      throw new IllegalArgumentException("dailyResetZone is not a time zone: " + dailyResetZone, e);
    }
    if (maxLots < 1) {
      throw new IllegalArgumentException("maxLots must be positive: " + maxLots);
    }
  }

  public ZoneId zone() {
    return ZoneId.of(dailyResetZone);
  }
}
