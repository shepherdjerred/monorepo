package com.shepherdjerred.thestorm.rwfbots.domain.map;

/** Something wrong with a baked artifact that makes it unplayable. */
public record NavProblem(Kind kind, String detail) {

  /** The kinds of problem. */
  public enum Kind {
    NO_SPAWNS,
    NO_BOMBS,
    SPAWN_NOT_WALKABLE,
    BOMB_NOT_APPROACHABLE,
    BOMB_UNREACHABLE,
    DISTANCE_FIELD_MISSING
  }

  @Override
  public String toString() {
    return kind + ": " + detail;
  }
}
