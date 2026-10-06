package com.shepherdjerred.thestorm.rwfbots.domain.learning;

/**
 * Dataset action order: back-left, back, back-right, left, stop, right, forward-left, forward,
 * forward-right.
 */
public record CombatAction(int move, boolean jump, boolean sneak, boolean sprint, boolean attack) {
  public CombatAction {
    if (move < 0 || move > 8) throw new IllegalArgumentException("move must be 0..8");
  }

  public int forward() {
    return move / 3 - 1;
  }

  public int side() {
    return move % 3 - 1;
  }
}
