package com.shepherdjerred.thestorm.skylands.adapter.paper;

import com.shepherdjerred.thestorm.skylands.domain.SkyPosition;
import java.util.List;
import java.util.Map;

/**
 * Relative final-state patches for Paper 26.3's native pieces; never world layout coordinates.
 * Palette loading verifies every connector against this small version-pinned contract.
 */
final class NativeSkyConnectors {
  record Connector(SkyPosition position, String block) {}

  private NativeSkyConnectors() {}

  static final Map<String, List<Connector>> LINKS =
      Map.ofEntries(
          Map.entry(
              "village/plains/houses/plains_big_house_1",
              List.of(
                  new Connector(new SkyPosition(3, 0, 3), "minecraft:cobblestone"),
                  new Connector(new SkyPosition(3, 0, 8), "minecraft:cobblestone"),
                  new Connector(new SkyPosition(0, 1, 5), "minecraft:structure_void"),
                  new Connector(new SkyPosition(3, 4, 2), "minecraft:oak_planks"),
                  new Connector(new SkyPosition(3, 4, 8), "minecraft:oak_planks"))),
          Map.entry(
              "village/plains/houses/plains_medium_house_2",
              List.of(
                  new Connector(
                      new SkyPosition(0, 0, 6),
                      "minecraft:cobblestone_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]"),
                  new Connector(new SkyPosition(3, 0, 4), "minecraft:cobblestone"),
                  new Connector(new SkyPosition(3, 0, 8), "minecraft:cobblestone"))),
          Map.entry(
              "village/plains/houses/plains_small_house_4",
              List.of(
                  new Connector(
                      new SkyPosition(0, 0, 3),
                      "minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]"),
                  new Connector(new SkyPosition(3, 0, 3), "minecraft:oak_planks"))),
          Map.entry(
              "village/plains/houses/plains_small_farm_1",
              List.of(new Connector(new SkyPosition(0, 0, 4), "minecraft:oak_log"))),
          Map.entry(
              "village/plains/houses/plains_library_2",
              List.of(new Connector(new SkyPosition(0, 1, 4), "minecraft:oak_fence"))),
          Map.entry(
              "village/plains/houses/plains_small_house_6",
              List.of(
                  new Connector(new SkyPosition(0, 0, 3), "minecraft:structure_void"),
                  new Connector(new SkyPosition(3, 0, 4), "minecraft:cobblestone"))),
          Map.entry(
              "village/plains/houses/plains_small_house_3",
              List.of(
                  new Connector(
                      new SkyPosition(0, 0, 3),
                      "minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]"),
                  new Connector(new SkyPosition(3, 0, 3), "minecraft:oak_planks"))),
          Map.entry(
              "ancient_city/city_center/city_center_1",
              List.of(
                  new Connector(new SkyPosition(0, 1, 0), "minecraft:deepslate_bricks"),
                  new Connector(new SkyPosition(0, 1, 40), "minecraft:deepslate"),
                  new Connector(new SkyPosition(17, 1, 0), "minecraft:deepslate_bricks"),
                  new Connector(new SkyPosition(17, 1, 40), "minecraft:deepslate"),
                  new Connector(new SkyPosition(13, 24, 20), "minecraft:reinforced_deepslate"))),
          Map.entry(
              "ancient_city/structures/barracks",
              List.of(
                  new Connector(new SkyPosition(0, 0, 8), "minecraft:structure_void"),
                  new Connector(new SkyPosition(10, 3, 10), "minecraft:deepslate"),
                  new Connector(new SkyPosition(11, 3, 2), "minecraft:deepslate"))),
          Map.entry(
              "ancient_city/structures/chamber_1",
              List.of(
                  new Connector(new SkyPosition(12, 0, 6), "minecraft:deepslate"),
                  new Connector(new SkyPosition(18, 0, 7), "minecraft:structure_void"),
                  new Connector(new SkyPosition(5, 3, 1), "minecraft:deepslate"))),
          Map.entry(
              "ancient_city/structures/chamber_2",
              List.of(
                  new Connector(new SkyPosition(11, 0, 6), "minecraft:structure_void"),
                  new Connector(new SkyPosition(8, 1, 5), "minecraft:deepslate"))),
          Map.entry(
              "ancient_city/structures/chamber_3",
              List.of(
                  new Connector(new SkyPosition(4, 0, 7), "minecraft:deepslate"),
                  new Connector(new SkyPosition(9, 0, 5), "minecraft:structure_void"))),
          Map.entry(
              "ancient_city/structures/ice_box_1",
              List.of(
                  new Connector(new SkyPosition(12, 0, 6), "minecraft:deepslate"),
                  new Connector(new SkyPosition(18, 0, 7), "minecraft:structure_void"),
                  new Connector(new SkyPosition(5, 3, 1), "minecraft:deepslate"))),
          Map.entry(
              "ancient_city/structures/medium_ruin_1",
              List.of(new Connector(new SkyPosition(0, 0, 6), "minecraft:structure_void"))),
          Map.entry(
              "ancient_city/structures/medium_ruin_2",
              List.of(new Connector(new SkyPosition(0, 0, 5), "minecraft:cobbled_deepslate"))),
          Map.entry(
              "ancient_city/structures/small_statue",
              List.of(
                  new Connector(new SkyPosition(0, 0, 3), "minecraft:structure_void"),
                  new Connector(new SkyPosition(0, 0, 5), "minecraft:structure_void"))),
          Map.entry(
              "ancient_city/structures/tall_ruin_2",
              List.of(new Connector(new SkyPosition(9, 0, 0), "minecraft:air"))));
}
