package com.shepherdjerred.thestorm.world.domain;

/**
 * A world border. Size is its full diameter, rather than a radius. A {@code square} border is the
 * native Minecraft border; a {@code circle} border keeps the native square at the same diameter as
 * the hard limit and is enforced as a disc on top of it.
 *
 * @param world the world name
 * @param centerX border center x
 * @param centerZ border center z
 * @param size the diameter
 * @param shape {@code square} or {@code circle}
 */
public record WorldBorderSpec(
    String world, double centerX, double centerZ, double size, String shape) {

  public WorldBorderSpec {
    if (world == null || world.isBlank()) {
      throw new IllegalArgumentException("border world is required");
    }
    if (!Double.isFinite(centerX)
        || !Double.isFinite(centerZ)
        || Math.abs(centerX) > 29_999_984
        || Math.abs(centerZ) > 29_999_984) {
      throw new IllegalArgumentException("border center must be inside Minecraft's world bounds");
    }
    if (!Double.isFinite(size) || size < 1 || size > 59_999_968) {
      throw new IllegalArgumentException("border size must be a diameter between 1 and 59999968");
    }
    if (!"square".equals(shape) && !"circle".equals(shape)) {
      throw new IllegalArgumentException("border shape must be square or circle: " + shape);
    }
  }

  /** The disc players stay inside, when this border is a circle. */
  public java.util.Optional<CircleEdge> circle() {
    if (!"circle".equals(shape)) {
      return java.util.Optional.empty();
    }
    return java.util.Optional.of(new CircleEdge(world, centerX, centerZ, size / 2));
  }
}
