package com.shepherdjerred.thestorm.tracks.domain;

import java.util.List;

/**
 * What one track level is called and what it unlocks, as shown by {@code /perks info}.
 *
 * @param title the rank's name, for example "Tinkerer"
 * @param unlocks one line per feature the level unlocks
 */
public record LevelInfo(String title, List<String> unlocks) {

  public LevelInfo {
    unlocks = List.copyOf(unlocks);
    if (title.isBlank()) {
      throw new IllegalArgumentException("a level needs a title");
    }
    if (unlocks.isEmpty() || unlocks.stream().anyMatch(String::isBlank)) {
      throw new IllegalArgumentException(title + " needs at least one non-blank unlock");
    }
  }
}
