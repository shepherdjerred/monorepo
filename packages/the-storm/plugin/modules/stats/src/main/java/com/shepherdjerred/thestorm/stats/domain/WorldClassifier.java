package com.shepherdjerred.thestorm.stats.domain;

import java.util.Locale;

/** Classifies Bukkit world names and player states into canonical world and mode buckets. */
public final class WorldClassifier {

  private WorldClassifier() {}

  public static WorldBucket classifyWorld(String worldName, boolean inArena) {
    if (inArena) {
      return WorldBucket.ARENA;
    }
    var normalized = worldName.strip().toLowerCase(Locale.ROOT);
    if (normalized.equals("rwf")
        || normalized.equals("rwf_lobby")
        || normalized.startsWith("rwf_")) {
      return WorldBucket.RWF;
    }
    if (normalized.equals("arena") || normalized.startsWith("arena_")) {
      return WorldBucket.ARENA;
    }
    return switch (normalized) {
      case "frontier" -> WorldBucket.FRONTIER;
      case "world" -> WorldBucket.WORLD;
      case "map2" -> WorldBucket.MAP2;
      case "skylands" -> WorldBucket.SKYLANDS;
      case "world_nether" -> WorldBucket.WORLD_NETHER;
      case "world_the_end" -> WorldBucket.WORLD_THE_END;
      case "creative" -> WorldBucket.CREATIVE;
      case "settlement", "rustworks" -> WorldBucket.ARENA;
      default -> WorldBucket.OTHER;
    };
  }

  public static GameModeBucket classifyMode(
      WorldBucket worldBucket, boolean inArena, boolean creativeGameMode) {
    if (inArena || worldBucket == WorldBucket.ARENA) {
      return GameModeBucket.ARENA;
    }
    if (worldBucket == WorldBucket.RWF) {
      return GameModeBucket.RWF;
    }
    if (worldBucket == WorldBucket.CREATIVE || creativeGameMode) {
      return GameModeBucket.CREATIVE;
    }
    return GameModeBucket.SURVIVAL;
  }

  /**
   * Survival combat excludes minigame and creative worlds so match deaths never pollute PvP/PvE.
   */
  public static boolean isSurvivalCombatWorld(WorldBucket worldBucket, boolean inArena) {
    return !inArena
        && worldBucket != WorldBucket.RWF
        && worldBucket != WorldBucket.ARENA
        && worldBucket != WorldBucket.CREATIVE;
  }
}
