package com.shepherdjerred.thestorm.arena.domain.survival;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import java.util.LinkedHashMap;
import java.util.Map;

/** Bounded authored layout: eight districts, cross routes, buildings, a mine and two towers. */
public final class SettlementBlueprint {
  private final Map<BlockPos, String> blocks = new LinkedHashMap<>();
  private final SurvivalContent content;
  private final int floor;

  public SettlementBlueprint(SurvivalContent content) {
    this.content = content;
    floor = content.arena().playerSpawns().getFirst().point().block().y() - 1;
  }

  public Map<BlockPos, String> blocks() {
    if (blocks.isEmpty()) {
      build();
    }
    return java.util.Collections.unmodifiableMap(new LinkedHashMap<>(blocks));
  }

  private void build() {
    var region = content.arena().region();
    foundations();
    for (var x = region.min().x(); x <= region.max().x(); x++) {
      for (var z = region.min().z(); z <= region.max().z(); z++) {
        put(x, floor, z, "STONE_BRICKS");
        for (var y = floor + 1; y <= floor + 12; y++) {
          put(x, y, z, "AIR");
        }
      }
    }
    content.zones().forEach(this::district);
    var exit = content.arena().exit().point().block();
    put(exit.x(), exit.y() - 1, exit.z(), "STONE_BRICKS");
    put(exit.x(), exit.y(), exit.z(), "AIR");
    put(exit.x(), exit.y() + 1, exit.z(), "AIR");
    content.arena().classSigns().values().forEach(p -> put(p.x(), p.y(), p.z(), "OAK_SIGN"));
    var ready = content.arena().readyBlock();
    put(ready.x(), ready.y(), ready.z(), "IRON_BLOCK");
    var spectator = content.arena().spectator().point().block();
    tower(spectator.x(), spectator.z());
  }

  private void foundations() {
    var region = content.arena().region();
    for (var x = region.min().x(); x <= region.max().x(); x++) {
      for (var z = region.min().z(); z <= region.max().z(); z++) {
        var perimeter =
            x == region.min().x()
                || x == region.max().x()
                || z == region.min().z()
                || z == region.max().z();
        var pier = (x - region.min().x()) % 16 == 0 && (z - region.min().z()) % 16 == 0;
        if (perimeter || pier) {
          for (var y = region.min().y(); y < floor; y++) {
            put(x, y, z, "MOSSY_STONE_BRICKS");
          }
        }
      }
    }
  }

  private void district(SurvivalContent.Zone zone) {
    var min = zone.bounds().min();
    var max = zone.bounds().max();
    boundaries(zone);
    put(min.x() + 20, floor + 1, min.z() + 5, "OAK_SIGN");
    house(min.x() + 6, min.z() + 6);
    house(min.x() + 23, min.z() + 55);
    zone.gate().forEach(p -> put(p.x(), p.y(), p.z(), zone.emeralds() == 0 ? "AIR" : "IRON_BARS"));
    zone.stations()
        .forEach(
            s ->
                put(
                    s.block().x(),
                    s.block().y(),
                    s.block().z(),
                    switch (s.type()) {
                      case WORKBENCH -> "CRAFTING_TABLE";
                      case FORGE -> "SMITHING_TABLE";
                      case INFIRMARY -> "CAULDRON";
                      case ALCHEMY -> "ENCHANTING_TABLE";
                    }));
    zone.resources()
        .forEach(
            r ->
                put(
                    r.block().x(),
                    r.block().y(),
                    r.block().z(),
                    switch (r.material()) {
                      case "OAK_PLANKS" -> "OAK_LOG";
                      case "IRON_INGOT" -> "IRON_ORE";
                      case "REDSTONE" -> "REDSTONE_ORE";
                      case "GLOWSTONE_DUST" -> "GLOWSTONE";
                      case "BONE" -> "BONE_BLOCK";
                      case "WHEAT" -> "HAY_BLOCK";
                      case "FLINT" -> "GRAVEL";
                      case "COBBLESTONE" -> "MOSSY_COBBLESTONE";
                      default ->
                          throw new IllegalArgumentException(
                              "No authored node for " + r.material());
                    }));
    zone.defenses()
        .forEach(
            d ->
                put(
                    d.block().x(),
                    d.block().y(),
                    d.block().z(),
                    d.type() == SurvivalContent.DefenseType.BARRICADE
                        ? "OAK_FENCE"
                        : "STONE_PRESSURE_PLATE"));
    entrance(zone);
    if (zone.id().equals("quarry")) {
      mine(min.x() + 14, min.z() + 24);
    }
    if (zone.id().equals("ramparts")) {
      tower(min.x() + 28, min.z() + 18);
    }
    for (var z = min.z() + 10; z < max.z(); z += 15) {
      put(min.x() + 20, floor, z, "SEA_LANTERN");
    }
  }

  private void house(int x, int z) {
    buildHouse(x, z);
  }

  private void boundaries(SurvivalContent.Zone zone) {
    var min = zone.bounds().min();
    var max = zone.bounds().max();
    for (var x = min.x(); x <= max.x(); x++) {
      for (var y = floor + 1; y <= floor + 4; y++) {
        put(x, y, min.z(), "STONE_BRICKS");
        put(x, y, max.z(), "STONE_BRICKS");
      }
    }
    for (var z = min.z(); z <= max.z(); z++) {
      for (var y = floor + 1; y <= floor + 4; y++) {
        put(min.x(), y, z, "STONE_BRICKS");
        put(max.x(), y, z, "STONE_BRICKS");
      }
    }
  }

  private void buildHouse(int x, int z) {
    for (var dx = 0; dx <= 10; dx++) {
      for (var dz = 0; dz <= 12; dz++) {
        for (var y = floor + 1; y <= floor + 4; y++) {
          var edge = dx == 0 || dx == 10 || dz == 0 || dz == 12;
          put(x + dx, y, z + dz, edge ? "STONE_BRICKS" : "AIR");
        }
        put(x + dx, floor + 5, z + dz, "SPRUCE_PLANKS");
      }
    }
    for (var dx = 4; dx <= 6; dx++) {
      for (var y = floor + 1; y <= floor + 3; y++) {
        put(x + dx, y, z + 12, "AIR");
      }
    }
    put(x + 5, floor + 4, z + 6, "SEA_LANTERN");
  }

  private void entrance(SurvivalContent.Zone zone) {
    var entry = zone.entrance().block();
    for (var z = entry.z() - 5; z <= entry.z() + 3; z++) {
      for (var y = floor + 1; y <= floor + 3; y++) {
        put(entry.x() - 2, y, z, "STONE_BRICKS");
        put(entry.x() + 2, y, z, "STONE_BRICKS");
      }
    }
    zone.defenses().stream()
        .filter(d -> d.type() == SurvivalContent.DefenseType.BARRICADE)
        .forEach(
            d -> {
              for (var dx = -1; dx <= 1; dx++) {
                put(d.block().x() + dx, d.block().y(), d.block().z(), "OAK_FENCE");
              }
            });
  }

  private void mine(int x, int z) {
    excavate(x, z);
    for (var step = 0; step <= 6; step++) {
      for (var dx = 0; dx < 3; dx++) {
        put(x + dx, floor - step, z - 6 + step, "STONE_BRICKS");
        for (var y = floor - step + 1; y <= floor + 2; y++) {
          put(x + dx, y, z - 6 + step, "AIR");
        }
      }
    }
    put(x + 7, floor - 6, z + 8, "SEA_LANTERN");
  }

  private void excavate(int x, int z) {
    for (var dx = 0; dx < 14; dx++) {
      for (var dz = 0; dz < 16; dz++) {
        put(x + dx, floor - 6, z + dz, "DEEPSLATE_BRICKS");
        for (var y = floor - 5; y <= floor; y++) {
          var edge = dx == 0 || dx == 13 || dz == 0 || dz == 15;
          put(x + dx, y, z + dz, edge ? "DEEPSLATE_BRICKS" : "AIR");
        }
      }
    }
  }

  private void tower(int x, int z) {
    for (var dx = -3; dx <= 3; dx++) {
      for (var dz = -3; dz <= 3; dz++) {
        put(x + dx, floor + 8, z + dz, "STONE_BRICKS");
      }
    }
    for (var step = 0; step <= 8; step++) {
      put(x + 4, floor + step, z + 8 - step, "STONE_BRICKS");
      put(x + 3, floor + step, z + 8 - step, "STONE_BRICKS");
    }
  }

  private void put(int x, int y, int z, String material) {
    var position = new BlockPos(x, y, z);
    if (!content.arena().region().contains(position)
        && !position.equals(content.arena().exit().point().block())
        && !(x == content.arena().exit().point().block().x()
            && z == content.arena().exit().point().block().z()
            && Math.abs(y - content.arena().exit().y()) <= 1)) {
      throw new IllegalArgumentException("Blueprint exceeds its authored footprint: " + position);
    }
    blocks.put(position, material);
  }
}
