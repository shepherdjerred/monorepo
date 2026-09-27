package com.shepherdjerred.thestorm.agent.domain;

import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Matches ticket text against the known-answer catalog. Matching is a case-insensitive substring
 * search, deterministic and brain-free: a known question should never spend a model call. The first
 * entry in catalog order with any keyword hit wins.
 */
public final class FaqMatcher {

  private FaqMatcher() {}

  /** The first entry matching {@code text}, when one does. */
  public static Optional<FaqEntry> match(String text, List<FaqEntry> entries) {
    var lowered = text.toLowerCase(Locale.ROOT);
    for (var entry : entries) {
      for (var keyword : entry.keywords()) {
        if (!keyword.isBlank() && lowered.contains(keyword.toLowerCase(Locale.ROOT))) {
          return Optional.of(entry);
        }
      }
    }
    return Optional.empty();
  }
}
