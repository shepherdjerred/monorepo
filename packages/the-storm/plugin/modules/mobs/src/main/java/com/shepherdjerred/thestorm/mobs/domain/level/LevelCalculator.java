package com.shepherdjerred.thestorm.mobs.domain.level;

import java.util.Optional;
import java.util.random.RandomGenerator;

/**
 * Picks a spawning mob's level: a level drawn from its distance band, plus depth levels
 * underground, plus the moon's levels at night, kept between 1 and the cap.
 */
public final class LevelCalculator {

  private final LevelRules rules;

  public LevelCalculator(LevelRules rules) {
    this.rules = rules;
  }

  /** The level for a mob spawning at {@code site}, or empty if its world never levels mobs. */
  public Optional<Levelled> level(SpawnSite site, RandomGenerator random) {
    return rules.world(site.world()).map(world -> level(site, world, random));
  }

  private Levelled level(SpawnSite site, WorldRule world, RandomGenerator random) {
    var band = rules.bandAt(site.distance() * world.distanceScale());
    var base = random.nextInt(band.min(), band.max() + 1);
    var depth = world.depth() ? rules.depth().bonus(site.y(), base) : 0;
    var moon = world.moon() && site.night() ? rules.moonBonus(site.moonPhase()) : 0;
    var level = Math.clamp((long) base + depth + moon, 1, rules.cap());
    return new Levelled(base, depth, moon, level);
  }

  /** The level cap. */
  public int cap() {
    return rules.cap();
  }
}
