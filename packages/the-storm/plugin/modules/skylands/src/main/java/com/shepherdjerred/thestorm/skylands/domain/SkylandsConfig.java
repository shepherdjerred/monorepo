package com.shepherdjerred.thestorm.skylands.domain;

import java.util.regex.Pattern;

/**
 * Boot identity of the layered world. The same JSON document is checked by the image's pre-start
 * guard before Paper can open an existing save. Terrain policy belongs to the generator.
 */
public record SkylandsConfig(String world, long seed, String format) {

  /** The overworld build limits of a NORMAL world: y -64 up to, not including, 320. */
  public static final int MIN_Y = -64;

  public static final int MAX_Y = 320;
  public static final String FORMAT = "layered-v1";
  private static final Pattern WORLD = Pattern.compile("[a-z0-9_]+");

  public SkylandsConfig {
    if (!WORLD.matcher(world).matches()) {
      throw new IllegalArgumentException("world must be a lowercase key path: " + world);
    }
    if (!FORMAT.equals(format)) {
      throw new IllegalArgumentException("Skylands format must be " + FORMAT + ": " + format);
    }
  }
}
