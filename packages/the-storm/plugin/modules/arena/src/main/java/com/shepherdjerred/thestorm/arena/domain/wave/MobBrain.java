package com.shepherdjerred.thestorm.arena.domain.wave;

import java.util.OptionalDouble;

/** The custom AI on top of vanilla: what a mob with a {@link Behavior} should do this second. */
public final class MobBrain {

  /** How close a kamikaze mob gets before it explodes. */
  public static final double DETONATE_RANGE = 2.5;

  /** How close a follower keeps to its fighter. */
  public static final double FOLLOW_RANGE = 3;

  private MobBrain() {}

  /** What to do. */
  public enum Action {
    /** Leave the mob to its vanilla AI. */
    NOTHING,
    /** Target the nearest fighter. */
    HUNT,
    /** Walk towards the nearest fighter without attacking. */
    APPROACH,
    /** Explode now. */
    DETONATE,
  }

  /**
   * Decides for a mob whose nearest fighter is {@code nearest} blocks away (empty when no fighter
   * is left).
   */
  public static Action decide(Behavior behavior, OptionalDouble nearest) {
    if (nearest.isEmpty()) {
      return Action.NOTHING;
    }
    var distance = nearest.getAsDouble();
    return switch (behavior) {
      case VANILLA -> Action.NOTHING;
      case CHASE -> Action.HUNT;
      case KAMIKAZE -> distance <= DETONATE_RANGE ? Action.DETONATE : Action.HUNT;
      case FOLLOW -> distance > FOLLOW_RANGE ? Action.APPROACH : Action.NOTHING;
    };
  }
}
