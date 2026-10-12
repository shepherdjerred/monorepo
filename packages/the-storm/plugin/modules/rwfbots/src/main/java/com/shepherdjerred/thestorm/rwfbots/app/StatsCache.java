package com.shepherdjerred.thestorm.rwfbots.app;

import com.shepherdjerred.thestorm.rwfbots.domain.director.Rating;
import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * The personality records as the main thread sees them: loaded once from the store at enable, read
 * synchronously when a match is filled, and written through after every match. Main thread only.
 */
public final class StatsCache {

  private final Map<String, PersonalityStats> records = new HashMap<>();
  private boolean loaded;

  /** Replaces the cache with what the store holds. */
  public void load(Collection<PersonalityStats> stored) {
    records.clear();
    for (var stats : stored) {
      records.put(stats.personalityId(), stats);
    }
    loaded = true;
  }

  /** Whether the store has been read; until then every personality counts as new. */
  public boolean loaded() {
    return loaded;
  }

  public Optional<PersonalityStats> of(String personalityId) {
    return Optional.ofNullable(records.get(personalityId));
  }

  /** The stored ratings by personality id. */
  public Map<String, Rating> ratings() {
    var ratings = new HashMap<String, Rating>();
    records.forEach((id, stats) -> ratings.put(id, stats.rating()));
    return Map.copyOf(ratings);
  }

  /** The record of {@code personalityId}, or a fresh one at {@code rating} seen {@code now}. */
  public PersonalityStats orFresh(String personalityId, Rating rating, Instant now) {
    return of(personalityId).orElseGet(() -> PersonalityStats.fresh(personalityId, rating, now));
  }

  public void put(Collection<PersonalityStats> updated) {
    for (var stats : updated) {
      records.put(stats.personalityId(), stats);
    }
  }

  public int size() {
    return records.size();
  }
}
