package com.shepherdjerred.thestorm.rwfbots.domain.world;

/** What a bomb is doing. */
public sealed interface BombState {

  /** Nobody is touching it. */
  record Idle() implements BombState {}

  /**
   * Being armed by {@code team}.
   *
   * @param team who is arming
   * @param progress 0..1 of the arm time done
   * @param clickerCount how many distinct players have clicked this attempt
   */
  record Arming(TeamId team, double progress, int clickerCount) implements BombState {

    public Arming {
      if (!(progress >= 0 && progress <= 1)) {
        throw new IllegalArgumentException("progress must be 0..1: " + progress);
      }
      if (clickerCount < 0) {
        throw new IllegalArgumentException("clicker count must not be negative");
      }
    }
  }

  /**
   * Fuse lit, counting down.
   *
   * @param remainingTicks ticks until it explodes
   */
  record Armed(long remainingTicks) implements BombState {

    public Armed {
      if (remainingTicks < 0) {
        throw new IllegalArgumentException("remaining ticks must not be negative");
      }
    }
  }

  /**
   * The owning team's players are defusing it.
   *
   * @param progress 0..1 of the defuse time done
   * @param clickerCount how many distinct players have clicked this attempt
   * @param remainingTicks ticks left on the fuse
   */
  record Defusing(double progress, int clickerCount, long remainingTicks) implements BombState {

    public Defusing {
      if (!(progress >= 0 && progress <= 1)) {
        throw new IllegalArgumentException("progress must be 0..1: " + progress);
      }
      if (clickerCount < 0 || remainingTicks < 0) {
        throw new IllegalArgumentException("counts must not be negative");
      }
    }
  }

  /** It went off. */
  record Destroyed() implements BombState {}

  /** Whether the fuse is lit (armed or being defused). */
  default boolean isLit() {
    return this instanceof Armed || this instanceof Defusing;
  }
}
