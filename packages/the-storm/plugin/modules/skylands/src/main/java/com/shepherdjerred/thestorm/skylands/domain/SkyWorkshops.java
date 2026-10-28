package com.shepherdjerred.thestorm.skylands.domain;

import java.util.List;

/** Profession furnishings belong to reusable house layouts, never to a central job-block row. */
public final class SkyWorkshops {
  private SkyWorkshops() {}

  public static List<SkyPlan.Edit> relative(String key) {
    var name = key.substring(key.lastIndexOf('/') + 1);
    return switch (name) {
      case "plains_small_house_4" ->
          List.of(
              new SkyPlan.Edit(new SkyPosition(2, 1, 2), "minecraft:smithing_table"),
              new SkyPlan.Edit(new SkyPosition(0, 0, 1), "minecraft:cobblestone"),
              new SkyPlan.Edit(
                  new SkyPosition(0, 1, 1), "minecraft:grindstone[face=floor,facing=west]"));
      case "plains_small_house_6" ->
          List.of(
              new SkyPlan.Edit(new SkyPosition(3, 1, 2), "minecraft:blast_furnace[facing=south]"));
      case "plains_medium_house_2" ->
          List.of(new SkyPlan.Edit(new SkyPosition(2, 1, 5), "minecraft:cartography_table"));
      case "plains_big_house_1" ->
          List.of(new SkyPlan.Edit(new SkyPosition(2, 1, 3), "minecraft:fletching_table"));
      default -> List.of();
    };
  }
}
