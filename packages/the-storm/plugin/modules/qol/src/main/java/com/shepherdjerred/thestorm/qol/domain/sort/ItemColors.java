package com.shepherdjerred.thestorm.qol.domain.sort;

import java.util.List;

/** The dye color named by an item key, or empty when the item is not dyed. Longer names win. */
public final class ItemColors {

  private static final List<String> COLORS =
      List.of(
          "light_blue",
          "light_gray",
          "white",
          "orange",
          "magenta",
          "yellow",
          "lime",
          "pink",
          "gray",
          "cyan",
          "purple",
          "blue",
          "brown",
          "green",
          "red",
          "black");

  private ItemColors() {}

  /** {@code minecraft:light_blue_wool} is {@code light_blue}. A plain item is empty. */
  public static String of(String materialKey) {
    var colon = materialKey.lastIndexOf(':');
    var name = colon < 0 ? materialKey : materialKey.substring(colon + 1);
    for (var color : COLORS) {
      if (name.equals(color)
          || name.startsWith(color + "_")
          || name.endsWith("_" + color)
          || name.contains("_" + color + "_")) {
        return color;
      }
    }
    return "";
  }
}
