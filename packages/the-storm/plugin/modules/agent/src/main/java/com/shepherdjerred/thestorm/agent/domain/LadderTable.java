package com.shepherdjerred.thestorm.agent.domain;

import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Every ladder, by offense. Offenses without a ladder have no autonomous answer: the agent
 * escalates them instead.
 */
public final class LadderTable {

  private final Map<Offense, Ladder> ladders;

  public LadderTable(List<Ladder> ladders) {
    Map<Offense, Ladder> byOffense = new EnumMap<>(Offense.class);
    for (var ladder : ladders) {
      if (byOffense.put(ladder.offense(), ladder) != null) {
        throw new IllegalArgumentException("duplicate ladder: " + ladder.offense().id());
      }
    }
    this.ladders = Map.copyOf(byOffense);
  }

  /** The ladder for {@code offense}, when staff wrote one. */
  public Optional<Ladder> ladder(Offense offense) {
    return Optional.ofNullable(ladders.get(offense));
  }
}
