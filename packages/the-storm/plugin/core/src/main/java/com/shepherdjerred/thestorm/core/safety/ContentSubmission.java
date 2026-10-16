package com.shepherdjerred.thestorm.core.safety;

import java.util.UUID;

/** One complete attempted publication. Components preserve non-visible text and links as JSON. */
public record ContentSubmission(
    UUID id,
    UUID player,
    String name,
    String surface,
    String audience,
    String text,
    String components,
    String object) {
  public ContentSubmission {
    if (id == null
        || player == null
        || name.isBlank()
        || surface.isBlank()
        || audience.isBlank()
        || text == null
        || components == null
        || object == null) throw new IllegalArgumentException("Incomplete content submission");
  }
}
