package com.shepherdjerred.thestorm.arena.domain.boss;

import com.shepherdjerred.thestorm.arena.domain.wave.AbilitySpec;
import com.shepherdjerred.thestorm.arena.domain.wave.AbilityType;
import java.util.random.RandomGenerator;

/**
 * The Creaking's heart: the boss cannot be hurt, but each heart fighters break costs it a share of
 * its max health, and a new heart grows somewhere else.
 *
 * @param hitsToBreak how many hits break a heart
 * @param hits hits on the current heart so far
 * @param damageFraction the share of max health one broken heart costs the boss
 */
public record HeartState(int hitsToBreak, int hits, double damageFraction) {

  public HeartState {
    if (hitsToBreak < 1 || hits < 0 || hits >= hitsToBreak) {
      throw new IllegalArgumentException("need 0 <= hits < hitsToBreak");
    }
    if (!(damageFraction > 0 && damageFraction <= 1)) {
      throw new IllegalArgumentException("damageFraction must be above 0 and at most 1");
    }
  }

  /** A fresh heart for the boss's {@link AbilityType#HEART} ability. */
  public static HeartState of(AbilitySpec heart) {
    if (heart.type() != AbilityType.HEART) {
      throw new IllegalArgumentException("not a heart ability: " + heart.type());
    }
    return new HeartState(heart.count(), 0, heart.power());
  }

  /** One hit on the heart. */
  public Hit hit() {
    if (hits + 1 >= hitsToBreak) {
      return new Hit.Broken(damageFraction, new HeartState(hitsToBreak, 0, damageFraction));
    }
    var next = new HeartState(hitsToBreak, hits + 1, damageFraction);
    return new Hit.Cracked(hitsToBreak - next.hits(), next);
  }

  /**
   * Where the heart grows next: any of {@code spots} mob spawns except {@code current}, or the same
   * one when it is the only spawn.
   */
  public static int relocate(int current, int spots, RandomGenerator random) {
    if (spots < 1 || current < 0 || current >= spots) {
      throw new IllegalArgumentException("need 0 <= current < spots");
    }
    if (spots == 1) {
      return 0;
    }
    var pick = random.nextInt(spots - 1);
    return pick >= current ? pick + 1 : pick;
  }

  /** The outcome of a hit. */
  public sealed interface Hit {

    /** The heart state after the hit. */
    HeartState heart();

    /**
     * The heart holds.
     *
     * @param remaining hits still needed
     * @param heart the heart afterwards
     */
    record Cracked(int remaining, HeartState heart) implements Hit {}

    /**
     * The heart breaks.
     *
     * @param damageFraction the share of max health the boss loses
     * @param heart the fresh heart that grows next
     */
    record Broken(double damageFraction, HeartState heart) implements Hit {}
  }
}
