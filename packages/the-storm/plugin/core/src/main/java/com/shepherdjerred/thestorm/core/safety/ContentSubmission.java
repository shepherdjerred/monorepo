package com.shepherdjerred.thestorm.core.safety;

import java.util.UUID;
import java.util.random.RandomGenerator;

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
  /** RFC version-4 IDs preserve injected randomness across the classifier boundary. */
  public static UUID newId(RandomGenerator random) {
    var most = (random.nextLong() & 0xffff_ffff_ffff_0fffL) | 0x0000_0000_0000_4000L;
    var least = (random.nextLong() & 0x3fff_ffff_ffff_ffffL) | 0x8000_0000_0000_0000L;
    return new UUID(most, least);
  }

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
