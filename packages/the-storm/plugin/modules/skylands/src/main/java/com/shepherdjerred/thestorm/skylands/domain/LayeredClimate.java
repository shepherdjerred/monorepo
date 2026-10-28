package com.shepherdjerred.thestorm.skylands.domain;

/** Continuous three-dimensional climate; biomes do not collapse a column to its highest island. */
public final class LayeredClimate {
  private static final java.util.List<java.util.List<String>> LAND =
      java.util.List.of(
          java.util.List.of("swamp", "forest", "plains"),
          java.util.List.of("pale_garden", "cherry_grove", "birch_forest"),
          java.util.List.of("old_growth_pine_taiga", "taiga", "old_growth_spruce_taiga"),
          java.util.List.of("mangrove_swamp", "jungle", "bamboo_jungle"),
          java.util.List.of("savanna", "desert", "desert"),
          java.util.List.of("badlands", "badlands", "wooded_badlands"),
          java.util.List.of("snowy_taiga", "snowy_plains", "ice_spikes"),
          java.util.List.of("mushroom_fields", "mushroom_fields", "mushroom_fields"));
  private final long seed;

  public LayeredClimate(long seed) {
    this.seed = seed;
  }

  private int climate(SkyPosition p) {
    var heat = SkyRandom.noise(p.x() / 160.0, p.y() / 160.0, p.z() / 160.0, seed + 918);
    var wet = SkyRandom.noise(p.x() / 130.0, p.y() / 200.0, p.z() / 130.0, seed + 171);
    if (heat > .28) return wet < -.05 ? 4 : 3;
    if (heat < -.28) return wet < 0 ? 6 : 2;
    if (wet > .29) return 7;
    if (wet < -.30) return 5;
    return heat < 0 ? 1 : 0;
  }

  public String biome(SkyPosition p, LayeredLandscape.Column column) {
    var sea = column.ocean();
    if (sea != null && p.y() >= sea.bottom() - 2 && oceanHeight(p, sea)) return seaBiome(sea);
    var kind = climate(p);
    if (p.y() > 222 && (kind == 2 || kind == 6)) return "snowy_slopes";
    if (p.y() >= 65 && p.y() <= 145) {
      var cave = SkyRandom.noise(p.x() / 140.0, 0, p.z() / 140.0, seed + 888);
      if (cave > .38) return "deep_dark";
      if (cave < -.4) return "lush_caves";
      if (cave < -.23) return "dripstone_caves";
    }
    var variation = SkyRandom.noise(p.x() / 80.0, p.y() / 180.0, p.z() / 80.0, seed + 1201);
    return land(kind, variation);
  }

  private static boolean oceanHeight(SkyPosition p, SkyOcean.Column sea) {
    // Native monument validation needs a small 3D neighbourhood above sea level.
    return p.y() <= (sea.wet() ? 63 : sea.ground() + 3)
        || (p.y() <= 96 && Math.hypot(p.x() - sea.centerX(), p.z() - sea.centerZ()) <= 44);
  }

  private static String seaBiome(SkyOcean.Column sea) {
    if (!sea.wet()) return sea.climate() == 2 ? "snowy_beach" : "beach";
    var deep = sea.ground() < 35;
    return switch (sea.climate()) {
      case 0 -> deep ? "deep_ocean" : "warm_ocean";
      case 1 -> deep ? "deep_cold_ocean" : "cold_ocean";
      case 2 -> deep ? "deep_frozen_ocean" : "frozen_ocean";
      default -> throw new IllegalStateException("Unknown ocean climate");
    };
  }

  private static String land(int kind, double variation) {
    return LAND.get(kind).get(variation < -.25 ? 0 : variation > .3 ? 2 : 1);
  }

  public String surface(SkyPosition p, int depth) {
    var kind = climate(p);
    if (depth == 0) {
      if (p.y() > 222 && (kind == 2 || kind == 6)) return "snow_block";
      return switch (kind) {
        case 4 -> "sand";
        case 5 -> "red_sand";
        case 6 -> "snow_block";
        case 7 -> "mycelium";
        default -> "grass_block";
      };
    }
    if (kind == 5 && depth < 15) return terracotta(p.y());
    if (depth < 4) return kind == 4 ? "sandstone" : "dirt";
    return "stone";
  }

  private static String terracotta(int y) {
    return switch (Math.floorMod(y / 3, 5)) {
      case 0 -> "orange_terracotta";
      case 1 -> "yellow_terracotta";
      case 2 -> "white_terracotta";
      case 3 -> "red_terracotta";
      default -> "terracotta";
    };
  }
}
