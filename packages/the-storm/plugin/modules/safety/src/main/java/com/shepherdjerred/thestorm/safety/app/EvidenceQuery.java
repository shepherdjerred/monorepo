package com.shepherdjerred.thestorm.safety.app;

import java.time.Instant;
import java.util.Set;
import java.util.UUID;

/** Strict query protocol shared by the authenticated bridge and the evidence exporter. */
public record EvidenceQuery(
    String action,
    String player,
    String text,
    String surface,
    String since,
    String until,
    long after,
    int limit,
    String id) {
  public EvidenceQuery {
    if (!ACTIONS.contains(action)
        || player == null
        || text == null
        || surface == null
        || id == null
        || after < 0
        || limit < 1
        || limit > 1000) throw new IllegalArgumentException("Invalid evidence query");
    if (Instant.parse(since).isAfter(Instant.parse(until)))
      throw new IllegalArgumentException("Invalid evidence time range");
    if (player.length() > 128 || text.length() > 4000 || surface.length() > 64 || id.length() > 36)
      throw new IllegalArgumentException("Evidence filter exceeds protocol limits");
    if (action.equals("show")) UUID.fromString(id);
  }

  public static final Set<String> ACTIONS = Set.of("search", "show", "export");
}
