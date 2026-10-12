package com.shepherdjerred.thestorm.rwfbots.domain.personality;

import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

/**
 * Every personality that exists, checked as a set: ids and names are unique, any two names are at
 * least two edits apart so players never confuse them, and every rival is a personality here.
 *
 * @param all every personality including retired ones
 */
public record PersonalityCatalog(List<Personality> all) {

  /** The least Levenshtein distance between two names, compared case-insensitively. */
  public static final int MIN_NAME_DISTANCE = 2;

  public PersonalityCatalog {
    all = List.copyOf(all);
    var ids = new HashSet<String>();
    var names = new HashSet<String>();
    for (var personality : all) {
      if (!ids.add(personality.id())) {
        throw new IllegalArgumentException("duplicate personality id: " + personality.id());
      }
      if (!names.add(personality.name().toLowerCase(Locale.ROOT))) {
        throw new IllegalArgumentException("duplicate personality name: " + personality.name());
      }
    }
    for (var personality : all) {
      for (var rival : personality.rivals()) {
        if (!ids.contains(rival)) {
          throw new IllegalArgumentException(
              personality.id() + " names an unknown rival: " + rival);
        }
      }
    }
    for (var i = 0; i < all.size(); i++) {
      for (var j = i + 1; j < all.size(); j++) {
        var a = all.get(i).name();
        var b = all.get(j).name();
        var distance =
            EditDistance.levenshtein(a.toLowerCase(Locale.ROOT), b.toLowerCase(Locale.ROOT));
        if (distance < MIN_NAME_DISTANCE) {
          throw new IllegalArgumentException("names too similar: " + a + " and " + b);
        }
      }
    }
  }

  /** Personalities that may be drafted. */
  public List<Personality> active() {
    return all.stream().filter(personality -> !personality.retired()).toList();
  }

  public Optional<Personality> byId(String id) {
    return all.stream().filter(personality -> personality.id().equals(id)).findFirst();
  }
}
