package com.shepherdjerred.thestorm.core.analytics;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

record AnalyticsWrite(Connection connection, List<AnalyticsEvent> events) {
  AnalyticsWrite {
    events = List.copyOf(events);
  }

  record Connection(
      UUID id,
      UUID player,
      String name,
      Instant started,
      Instant checkpoint,
      long connectedMillis,
      long activeMillis,
      boolean ended) {}
}
