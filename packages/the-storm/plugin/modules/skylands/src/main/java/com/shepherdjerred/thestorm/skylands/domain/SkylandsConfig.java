package com.shepherdjerred.thestorm.skylands.domain;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * plugins/TheStorm/skylands.yml. The skylands world is created and loaded by this module at
 * startup; it is never a Multiverse world.
 *
 * @param world the world name, also its {@code minecraft:} key
 * @param seed the world seed, which fixes the island layout
 * @param verticalOffset the world y that Beta's terrain y 0 is placed at
 * @param spawnSearchChunks how many chunk rings around the origin the spawn search covers
 * @param blockedStructures structure keys that are never placed in the world
 * @param biomeRemap vanilla biome key to the land biome placed instead, for water-only biomes
 * @param ores veins placed into island stone for ores whose vanilla bands lie below the islands
 */
public record SkylandsConfig(
    String world,
    long seed,
    int verticalOffset,
    int spawnSearchChunks,
    List<String> blockedStructures,
    Map<String, String> biomeRemap,
    List<OreVein> ores) {

  /** The overworld build limits of a NORMAL world: y -64 up to, not including, 320. */
  public static final int MIN_Y = -64;

  public static final int MAX_Y = 320;

  private static final Pattern WORLD = Pattern.compile("[a-z0-9_]+");
  private static final Pattern KEY = Pattern.compile("[a-z0-9_.-]+:[a-z0-9_./-]+");

  public SkylandsConfig {
    blockedStructures = List.copyOf(blockedStructures);
    biomeRemap = Map.copyOf(biomeRemap);
    ores = List.copyOf(ores);
    if (!WORLD.matcher(world).matches()) {
      throw new IllegalArgumentException("world must be a lowercase key path: " + world);
    }
    if (verticalOffset < MIN_Y || verticalOffset + SkyTerrain.HEIGHT > MAX_Y) {
      throw new IllegalArgumentException(
          "verticalOffset must keep the 128 terrain blocks inside y "
              + MIN_Y
              + ".."
              + (MAX_Y - 1)
              + ": "
              + verticalOffset);
    }
    if (spawnSearchChunks < 1 || spawnSearchChunks > 64) {
      throw new IllegalArgumentException("spawnSearchChunks must be 1-64: " + spawnSearchChunks);
    }
    var structures = new HashSet<String>();
    for (var structure : blockedStructures) {
      requireKey("blocked structure", structure);
      if (!structures.add(structure)) {
        throw new IllegalArgumentException("blocked structure " + structure + " is listed twice");
      }
    }
    for (var entry : biomeRemap.entrySet()) {
      requireKey("remapped biome", entry.getKey());
      requireKey("replacement biome", entry.getValue());
      if (biomeRemap.containsKey(entry.getValue())) {
        throw new IllegalArgumentException(
            "biome "
                + entry.getKey()
                + " is remapped to "
                + entry.getValue()
                + ", which is remapped too");
      }
    }
  }

  private static void requireKey(String role, String key) {
    if (!KEY.matcher(key).matches()) {
      throw new IllegalArgumentException(role + " must be a namespaced key: " + key);
    }
  }
}
