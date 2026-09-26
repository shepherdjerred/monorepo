package com.shepherdjerred.thestorm.quests.domain.model;

import java.util.List;
import java.util.Optional;

/**
 * A group players earn reputation with.
 *
 * @param id the faction id
 * @param name its display name
 * @param ranks named reputation thresholds, lowest first
 */
public record Faction(String id, String name, List<Rank> ranks) {

  public Faction {
    ranks = List.copyOf(ranks);
    for (var index = 1; index < ranks.size(); index++) {
      if (ranks.get(index).from() <= ranks.get(index - 1).from()) {
        throw new IllegalArgumentException("faction ranks must rise: " + id);
      }
    }
  }

  /** The rank for {@code reputation}: the highest whose threshold it reaches, if any. */
  public Optional<Rank> rank(long reputation) {
    return ranks.stream().filter(rank -> reputation >= rank.from()).reduce((low, high) -> high);
  }

  /** A named reputation level. */
  public record Rank(String name, long from) {}
}
