package com.shepherdjerred.thestorm.companions.domain;

import java.time.Instant;
import java.time.LocalTime;
import java.time.ZoneId;

/** Event-driven availability plus a hard gameplay deadline, independent of schedule delivery. */
public record Availability(ZoneId zone, LocalTime opens, LocalTime closes) {
  public Availability {
    if (!opens.isBefore(closes))
      throw new IllegalArgumentException("availability must close on the same day");
  }

  public boolean active(Instant now, int humans, boolean enabled) {
    var local = now.atZone(zone).toLocalTime();
    return enabled && humans > 0 && !local.isBefore(opens) && local.isBefore(closes);
  }
}
