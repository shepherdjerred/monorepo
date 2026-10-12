package com.shepherdjerred.thestorm.companions.domain;

import java.util.ArrayList;
import java.util.List;
import java.util.random.RandomGenerator;

/** Procedural, resource-accounted shelter geometry. Air is a doorway, never a destructive step. */
public record Blueprint(int width, int depth, List<Placement> blocks) {
  public record Placement(int x, int y, int z, String material) {}

  public Blueprint {
    blocks = List.copyOf(blocks);
    if (width < 3 || width > 12 || depth < 3 || depth > 12 || blocks.size() > 256)
      throw new IllegalArgumentException("building exceeds limits");
    if (blocks.stream()
        .anyMatch(
            block ->
                block.x() < 0
                    || block.x() >= width
                    || block.z() < 0
                    || block.z() >= depth
                    || block.y() < 0
                    || block.y() >= 8))
      throw new IllegalArgumentException("block outside building bounds");
  }

  public static Blueprint shelter(RandomGenerator random, String material) {
    var width = random.nextBoolean() ? 5 : 7;
    var depth = random.nextBoolean() ? 5 : 7;
    return rectangular(width, depth, material);
  }

  public static Blueprint rectangular(int width, int depth, String material) {
    var result = new ArrayList<Placement>();
    for (var y = 0; y < 5; y++) {
      for (var x = 0; x < width; x++) {
        for (var z = 0; z < depth; z++) {
          var doorway = doorway(x, y, z, width);
          var wall = x == 0 || z == 0 || x == width - 1 || z == depth - 1;
          if (!doorway && (y == 0 || y == 4 || wall)) result.add(new Placement(x, y, z, material));
        }
      }
    }
    return new Blueprint(width, depth, result);
  }

  private static boolean doorway(int x, int y, int z, int width) {
    return z == 0 && x == width / 2 && (y == 1 || y == 2);
  }
}
