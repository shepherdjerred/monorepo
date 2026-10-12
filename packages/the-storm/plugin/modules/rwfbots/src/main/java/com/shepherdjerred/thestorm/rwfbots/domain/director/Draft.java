package com.shepherdjerred.thestorm.rwfbots.domain.director;

import static java.util.Comparator.comparing;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Personality;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.PersonalityCatalog;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.random.RandomGenerator;

/** Picks the personalities for a match. */
public final class Draft {

  private Draft() {}

  /**
   * {@code count} distinct active personalities, uniformly at random from {@code random}. The
   * catalog must have enough.
   */
  public static List<Personality> draft(
      PersonalityCatalog catalog, int count, RandomGenerator random) {
    return draft(catalog, Set.of(), count, random);
  }

  /** Drafts from a validated catalog without revalidating a subset whose rivals may be excluded. */
  public static List<Personality> draft(
      PersonalityCatalog catalog, Set<String> excludedNames, int count, RandomGenerator random) {
    var excluded = excludedNames.stream().map(n -> n.toLowerCase(Locale.ROOT)).toList();
    var pool =
        new ArrayList<>(
            catalog.active().stream()
                .filter(p -> !excluded.contains(p.name().toLowerCase(Locale.ROOT)))
                .toList());
    if (count < 0 || count > pool.size()) {
      throw new IllegalArgumentException(
          "cannot draft " + count + " from " + pool.size() + " active personalities");
    }
    pool.sort(comparing(Personality::id));
    for (var i = pool.size() - 1; i > 0; i--) {
      var j = random.nextInt(i + 1);
      var swap = pool.get(i);
      pool.set(i, pool.get(j));
      pool.set(j, swap);
    }
    return List.copyOf(pool.subList(0, count));
  }
}
