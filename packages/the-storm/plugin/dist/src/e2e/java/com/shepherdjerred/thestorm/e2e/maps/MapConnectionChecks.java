package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.rwf.adapter.content.Schematic;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.bukkit.Bukkit;

/** Native regression cases, run outside CI with every catalog repair. */
final class MapConnectionChecks {
  private MapConnectionChecks() {}

  private record Target(String name, String state) {}

  static List<String> run() throws ReflectiveOperationException {
    var passed = new ArrayList<String>();
    check(
        passed, new Target("wooden-fences", "oak_fence"), Map.of(14, "spruce_fence"), "east=true");
    check(passed, new Target("fence-solid", "oak_fence"), Map.of(14, "stone"), "east=true");
    check(
        passed,
        new Target("fence-types", "oak_fence"),
        Map.of(14, "nether_brick_fence"),
        "east=false");
    check(
        passed,
        new Target("fence-gate", "oak_fence"),
        Map.of(14, "oak_fence_gate[facing=north]"),
        "east=true");
    check(
        passed,
        new Target("pane-colors", "glass_pane"),
        Map.of(14, "red_stained_glass_pane"),
        "east=true");
    check(passed, new Target("bars-pane", "iron_bars"), Map.of(14, "glass_pane"), "east=true");
    check(
        passed,
        new Target("waterlogged", "glass_pane[waterlogged=true]"),
        Map.of(14, "stone"),
        "east=true",
        "waterlogged=true");
    check(
        passed,
        new Target("wall-line", "cobblestone_wall"),
        Map.of(12, "cobblestone_wall", 14, "cobblestone_wall"),
        "east=low",
        "west=low",
        "up=false");
    check(
        passed,
        new Target("wall-covered", "cobblestone_wall"),
        Map.of(14, "cobblestone_wall", 22, "stone"),
        "east=tall");
    check(
        passed,
        new Target("stair-corner", "oak_stairs[facing=north]"),
        Map.of(10, "oak_stairs[facing=west]"),
        "shape=outer_left",
        "facing=north");
    check(
        passed,
        new Target("gate-in-wall", "oak_fence_gate[facing=north]"),
        Map.of(14, "cobblestone_wall"),
        "in_wall=true");
    return List.copyOf(passed);
  }

  private static void check(
      List<String> passed, Target target, Map<Integer, String> neighbors, String... expected)
      throws ReflectiveOperationException {
    var palette = new ArrayList<String>();
    palette.add("minecraft:air");
    palette.add(Bukkit.createBlockData("minecraft:" + target.state()).getAsString());
    var indices = new int[27];
    indices[13] = 1; // (1,1,1) in a 3x3x3 schematic
    for (var entry : neighbors.entrySet()) {
      indices[entry.getKey()] = palette.size();
      palette.add(Bukkit.createBlockData("minecraft:" + entry.getValue()).getAsString());
    }
    var input = new Schematic(new Schematic.Dimensions(3, 3, 3), palette, indices);
    var result = MapConnections.normalize(input);
    var actual = result.blocks().blockState(1, 1, 1);
    for (var property : expected) {
      if (!actual.contains(property))
        throw new IllegalStateException(target.name() + ": expected " + property + " in " + actual);
    }
    if (MapConnections.normalize(result.blocks()).changed() != 0)
      throw new IllegalStateException(target.name() + ": normalization is not stable");
    passed.add(target.name());
  }
}
