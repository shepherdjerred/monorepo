package com.shepherdjerred.thestorm.mobs.domain.config;

import java.util.List;
import java.util.regex.Pattern;

/**
 * The "Lv N Zombie" name levelled mobs wear.
 *
 * @param enabled whether levelled mobs are named at all
 * @param alwaysVisible whether the name shows through walls at any distance, rather than only when
 *     a player looks at the mob
 * @param colors the level's color, by the lowest level each color starts at; the first starts at 1
 */
public record Nameplate(boolean enabled, boolean alwaysVisible, List<ColorBand> colors) {

  private static final Pattern HEX = Pattern.compile("#[0-9A-Fa-f]{6}");

  /**
   * One color band.
   *
   * @param from the lowest level shown in this color
   * @param color a {@code #RRGGBB} color
   */
  public record ColorBand(int from, String color) {

    public ColorBand {
      if (from < 1) {
        throw new IllegalArgumentException("color bands start at level 1 or higher: " + from);
      }
      if (!HEX.matcher(color).matches()) {
        throw new IllegalArgumentException("colors are #RRGGBB: " + color);
      }
    }
  }

  public Nameplate {
    colors = List.copyOf(colors);
    if (colors.isEmpty() || colors.getFirst().from() != 1) {
      throw new IllegalArgumentException("the first color band must start at level 1");
    }
    for (var i = 1; i < colors.size(); i++) {
      if (colors.get(i).from() <= colors.get(i - 1).from()) {
        throw new IllegalArgumentException("color bands must be ordered by from");
      }
    }
  }

  /** The color for {@code level}. */
  public String colorFor(int level) {
    var chosen = colors.getFirst();
    for (var band : colors) {
      if (band.from() <= level) {
        chosen = band;
      }
    }
    return chosen.color();
  }
}
