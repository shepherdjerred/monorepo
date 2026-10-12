package com.shepherdjerred.thestorm.rwfbots.domain.world;

/** A bomb or nuke in the match. */
public record BombId(int value) implements Comparable<BombId> {

  public BombId {
    if (value < 0) {
      throw new IllegalArgumentException("bomb id must not be negative: " + value);
    }
  }

  @Override
  public int compareTo(BombId other) {
    return Integer.compare(value, other.value);
  }

  @Override
  public String toString() {
    return "bomb#" + value;
  }
}
