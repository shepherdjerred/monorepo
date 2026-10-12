package com.shepherdjerred.thestorm.rwfbots.domain.world;

/** A player or bot in the match. The adapter assigns small stable numbers per match. */
public record CombatantId(int value) implements Comparable<CombatantId> {

  public CombatantId {
    if (value < 0) {
      throw new IllegalArgumentException("combatant id must not be negative: " + value);
    }
  }

  @Override
  public int compareTo(CombatantId other) {
    return Integer.compare(value, other.value);
  }

  @Override
  public String toString() {
    return "#" + value;
  }
}
