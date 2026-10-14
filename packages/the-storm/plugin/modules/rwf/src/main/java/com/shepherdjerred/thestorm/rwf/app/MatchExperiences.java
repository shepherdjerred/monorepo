package com.shepherdjerred.thestorm.rwf.app;

import java.util.Optional;
import java.util.UUID;

/** Main-thread preferences: an operator edits the next draft, never an already drafted match. */
public final class MatchExperiences {
  private ExperienceSettings pending;
  private Optional<Frozen> current = Optional.empty();

  public record Frozen(UUID matchId, long seed, ExperienceSettings settings) {}

  public MatchExperiences(ExperienceSettings configured) {
    pending = java.util.Objects.requireNonNull(configured);
  }

  public ExperienceSettings pending() {
    return pending;
  }

  public void select(ExperienceSettings settings) {
    pending = java.util.Objects.requireNonNull(settings);
  }

  public Frozen freeze(UUID matchId, long seed) {
    var previous = current.filter(value -> value.matchId().equals(matchId));
    if (previous.isPresent()) {
      if (previous.orElseThrow().seed() != seed) {
        throw new IllegalStateException("cannot change the seed of a drafted match");
      }
      return previous.orElseThrow();
    }
    var frozen = new Frozen(matchId, seed, pending);
    current = Optional.of(frozen);
    return frozen;
  }

  public Optional<Frozen> current(UUID matchId) {
    return current.filter(value -> value.matchId().equals(matchId));
  }

  /** Only the guarded, empty showcase lobby may be reseeded after its map ballot exists. */
  public void reseedEmptyLobby(UUID matchId, long seed) {
    current =
        current.map(
            value ->
                value.matchId().equals(matchId)
                    ? new Frozen(matchId, seed, value.settings())
                    : value);
  }
}
