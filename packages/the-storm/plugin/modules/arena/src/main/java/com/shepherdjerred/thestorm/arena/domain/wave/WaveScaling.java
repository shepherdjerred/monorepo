package com.shepherdjerred.thestorm.arena.domain.wave;

/**
 * The scaling formulas. Mob health and damage are multipliers on the entity type's vanilla values;
 * boss health is absolute. Every result is capped at what the game allows.
 */
public final class WaveScaling {

  /** The largest value the vanilla {@code max_health} attribute accepts. */
  public static final double MAX_HEALTH = 1024;

  /** Rounding slack, so 2.0000000001 mobs is 2 and not 3. */
  private static final double EPSILON = 1e-9;

  private WaveScaling() {}

  /**
   * How many mobs a group spawns: its base count plus its growth for each wave into the range,
   * times the extra-player factor and the tier, rounded up. Never fewer than one.
   *
   * @param stepsIntoRange 0 on the first wave of the entry's range
   */
  public static int count(SpawnGroup group, int stepsIntoRange, Difficulty difficulty) {
    if (stepsIntoRange < 0) {
      throw new IllegalArgumentException("steps into the range must not be negative");
    }
    var base = group.count() + group.growth() * stepsIntoRange;
    var players = 1 + difficulty.scaling().countPerExtraPlayer() * difficulty.extraPlayers();
    var scaled = base * players * difficulty.tier().count();
    return Math.max(1, (int) Math.ceil(scaled - EPSILON));
  }

  /** The health multiplier for a mob on {@code wave}. Swarm mobs ignore the player count. */
  public static double mobHealth(MobArchetype mob, int wave, WaveKind kind, Difficulty difficulty) {
    var scaling = difficulty.scaling();
    var perWave = 1 + scaling.healthPerWave() * (wave - 1);
    var players =
        kind == WaveKind.SWARM ? 1 : 1 + scaling.healthPerExtraPlayer() * difficulty.extraPlayers();
    return mob.health() * perWave * players * difficulty.tier().health();
  }

  /** The damage multiplier for a mob or boss on {@code wave}. */
  public static double damage(MobArchetype mob, int wave, Difficulty difficulty) {
    var perWave = 1 + difficulty.scaling().damagePerWave() * (wave - 1);
    return mob.damage() * perWave * difficulty.tier().damage();
  }

  /** A boss's max health, capped at {@link #MAX_HEALTH}. */
  public static double bossHealth(BossDefinition boss, Difficulty difficulty) {
    var players = 1 + difficulty.scaling().bossHealthPerExtraPlayer() * difficulty.extraPlayers();
    return Math.min(MAX_HEALTH, boss.health() * players * difficulty.tier().health());
  }

  /** A mob's absolute max health: its type's vanilla max health times the multiplier, capped. */
  public static double absoluteHealth(double vanillaMaxHealth, double multiplier) {
    return Math.min(MAX_HEALTH, Math.max(1, vanillaMaxHealth * multiplier));
  }
}
