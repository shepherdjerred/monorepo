package com.shepherdjerred.thestorm.core.analytics;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

record AnalyticsEvent(UUID id, String event, Instant at, Map<String, Object> properties) {
  AnalyticsEvent {
    properties = Map.copyOf(properties);
  }
}
