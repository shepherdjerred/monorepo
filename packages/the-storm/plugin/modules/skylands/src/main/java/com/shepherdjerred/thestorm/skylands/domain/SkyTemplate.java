package com.shepherdjerred.thestorm.skylands.domain;

import java.util.List;

/** Native template geometry only; coordinates are relative and never select a world location. */
public record SkyTemplate(
    String key,
    SkyPosition size,
    SkyPosition entrance,
    List<SkyPosition> residents,
    int embeddedHeight) {
  public SkyTemplate {
    residents = List.copyOf(residents);
    if (size.x() < 1
        || size.y() < 1
        || size.z() < 1
        || embeddedHeight < 0
        || embeddedHeight >= size.y())
      throw new IllegalArgumentException("Invalid template " + key);
  }
}
