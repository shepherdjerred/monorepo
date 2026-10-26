package com.shepherdjerred.thestorm.creative.domain;

import java.util.Map;
import java.util.Objects;
import java.util.Optional;

/**
 * Floor, wall, and biome stored on a claim. Empty means the generator default: grass, stone, and
 * plains. Setting one does not rewrite blocks. {@link PlotGrid#generated} stays that default.
 */
public record PlotSurface(Optional<String> floor, Optional<String> wall, Optional<String> biome) {

  public static final PlotSurface DEFAULT =
      new PlotSurface(Optional.empty(), Optional.empty(), Optional.empty());

  private static final Map<String, String> FLOORS =
      Map.of(
          "dirt", "minecraft:dirt",
          "stone", "minecraft:stone",
          "cobblestone", "minecraft:cobblestone",
          "oak", "minecraft:oak_planks",
          "sand", "minecraft:sand",
          "podzol", "minecraft:podzol");

  private static final Map<String, String> WALLS =
      Map.of(
          "cobblestone", "minecraft:cobblestone",
          "stone_bricks", "minecraft:stone_bricks",
          "oak_log", "minecraft:oak_log",
          "oak_planks", "minecraft:oak_planks",
          "quartz", "minecraft:quartz_block");

  private static final Map<String, String> BIOMES =
      Map.of(
          "forest", "minecraft:forest",
          "birch_forest", "minecraft:birch_forest",
          "desert", "minecraft:desert",
          "savanna", "minecraft:savanna",
          "meadow", "minecraft:meadow",
          "jungle", "minecraft:jungle",
          "snowy_plains", "minecraft:snowy_plains");

  public PlotSurface {
    Objects.requireNonNull(floor);
    Objects.requireNonNull(wall);
    Objects.requireNonNull(biome);
  }

  public PlotSurface withFloor(Optional<String> next) {
    return new PlotSurface(next, wall, biome);
  }

  public PlotSurface withWall(Optional<String> next) {
    return new PlotSurface(floor, next, biome);
  }

  public PlotSurface withBiome(Optional<String> next) {
    return new PlotSurface(floor, wall, next);
  }

  /** A known name. Empty stored text is the generator default. */
  public record Choice(boolean known, Optional<String> stored) {

    public Choice {
      Objects.requireNonNull(stored);
    }

    static Choice unknown() {
      return new Choice(false, Optional.empty());
    }

    static Choice standard() {
      return new Choice(true, Optional.empty());
    }

    static Choice of(String stored) {
      return new Choice(true, Optional.of(stored));
    }
  }

  public static Choice floor(String name) {
    return choice(name, "grass", FLOORS);
  }

  public static Choice wall(String name) {
    return choice(name, "stone", WALLS);
  }

  public static Choice biome(String name) {
    return choice(name, "plains", BIOMES);
  }

  /** A stored floor id. Anything else is a corrupt row. */
  public static String requireFloor(String stored) {
    return require(stored, FLOORS, "floor");
  }

  /** A stored wall id. Anything else is a corrupt row. */
  public static String requireWall(String stored) {
    return require(stored, WALLS, "wall");
  }

  /** A stored biome id. Anything else is a corrupt row. */
  public static String requireBiome(String stored) {
    return require(stored, BIOMES, "biome");
  }

  public static String floors() {
    return "grass, dirt, stone, cobblestone, oak, sand, or podzol";
  }

  public static String walls() {
    return "stone, cobblestone, stone_bricks, oak_log, oak_planks, or quartz";
  }

  public static String biomes() {
    return "plains, forest, birch_forest, desert, savanna, meadow, jungle, or snowy_plains";
  }

  private static Choice choice(String name, String standard, Map<String, String> allowed) {
    if (name.equals(standard)) {
      return Choice.standard();
    }
    var stored = allowed.get(name);
    return stored == null ? Choice.unknown() : Choice.of(stored);
  }

  private static String require(String stored, Map<String, String> allowed, String kind) {
    if (!allowed.containsValue(stored)) {
      throw new IllegalArgumentException("unknown creative " + kind + ": " + stored);
    }
    return stored;
  }
}
