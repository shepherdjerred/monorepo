package com.shepherdjerred.thestorm.creative.domain;

import java.util.Optional;

/**
 * A square plot's grid coordinates, written {@code x;z} the way the 2016 world numbered them.
 *
 * @param x plot column, increasing east
 * @param z plot column, increasing south
 */
public record PlotId(int x, int z) {

  /** {@code x;z}, with a leading minus when a coordinate is negative. */
  public String text() {
    return x + ";" + z;
  }

  /** A canonical {@code x;z} id, or empty when {@code text} is not one. */
  public static Optional<PlotId> parse(String text) {
    var parts = text.split(";", -1);
    if (parts.length != 2) {
      return Optional.empty();
    }
    try {
      var id = new PlotId(Integer.parseInt(parts[0]), Integer.parseInt(parts[1]));
      if (!id.text().equals(text)) {
        return Optional.empty();
      }
      return Optional.of(id);
    } catch (NumberFormatException failure) {
      return Optional.empty();
    }
  }
}
