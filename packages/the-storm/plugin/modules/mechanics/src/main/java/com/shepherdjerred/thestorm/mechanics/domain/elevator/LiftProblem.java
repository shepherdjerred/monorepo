package com.shepherdjerred.thestorm.mechanics.domain.elevator;

/** Why a lift cannot move a player. Each explains itself. */
public sealed interface LiftProblem {

  String message();

  /** A {@code [Lift]} sign is only a floor to arrive at. */
  record FloorOnly() implements LiftProblem {
    @Override
    public String message() {
      return "This floor is a stop only; use a [Lift Up] or [Lift Down] sign.";
    }
  }

  /**
   * No lift sign in the column within reach.
   *
   * @param up whether the search went up
   * @param maxDistance how far it looked
   */
  record NoFloor(boolean up, int maxDistance) implements LiftProblem {
    @Override
    public String message() {
      return "No lift sign " + (up ? "above" : "below") + " within " + maxDistance + " blocks.";
    }
  }

  /**
   * The next floor has nowhere safe to stand.
   *
   * @param signY the height of that floor's sign
   */
  record UnsafeLanding(int signY) implements LiftProblem {
    @Override
    public String message() {
      return "The floor at height "
          + signY
          + " has nowhere safe to stand; clear two blocks over solid ground in front of its sign.";
    }
  }
}
