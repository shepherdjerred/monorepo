package com.shepherdjerred.thestorm.skylands.domain;

import java.util.Comparator;
import java.util.List;

/** Select complete native architectural families, including their real profession buildings. */
final class SkyVillagePalette {
  private final List<SkyTemplate> templates;
  private final long seed;

  SkyVillagePalette(List<SkyTemplate> templates, long seed) {
    this.templates = List.copyOf(templates);
    this.seed = seed;
  }

  static String family(String biome) {
    if (biome.contains("desert") || biome.contains("badlands")) return "desert";
    if (biome.contains("savanna")) return "savanna";
    if (biome.contains("snow") || biome.contains("frozen") || biome.contains("ice")) return "snowy";
    if (biome.contains("taiga") || biome.contains("grove")) return "taiga";
    return "plains";
  }

  List<SkyTemplate> centers(String family, SkyCell cell) {
    return select("village/" + family + "/town_centers/", cell);
  }

  List<SkyTemplate> buildings(String family, SkyCell cell) {
    return select("village/" + family + "/houses/", cell).stream()
        .filter(t -> !t.key().contains("accessory") && !t.key().contains("meeting_point"))
        .sorted(Comparator.comparingInt(t -> category(t.key())))
        .toList();
  }

  private List<SkyTemplate> select(String prefix, SkyCell cell) {
    return templates.stream()
        .filter(t -> t.key().startsWith(prefix))
        .sorted(Comparator.comparingLong(t -> SkyRandom.mix(cell.seed(seed) + t.key().hashCode())))
        .toList();
  }

  private static int category(String key) {
    if (key.contains("farm")) return 0;
    if (key.contains("library") || key.contains("temple") || key.contains("smith")) return 1;
    if (key.contains("small_house") || key.contains("medium_house") || key.contains("big_house"))
      return 2;
    return 3;
  }
}
