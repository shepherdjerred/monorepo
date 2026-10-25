package com.shepherdjerred.thestorm.creative.domain;

/**
 * What a clear writes, and what an unclaim requires. A road column is never part of a plot
 * footprint. A stored floor or wall replaces only the surface block. The wall top stays the
 * generator slab. Empty choices keep {@link PlotGrid#generated}.
 */
public final class PlotFootprint {

  private PlotFootprint() {}

  /** One column of block states, used to compare a footprint with the generator. */
  @FunctionalInterface
  public interface States {
    String at(int x, int y, int z);
  }

  /** A block position inside a footprint check. */
  public record At(int x, int y, int z) {}

  /** Inclusive build heights for a template check. */
  public record Band(int minY, int maxY) {}

  /** Block a clear places at {@code at}. Roads stay on the generator. */
  public static String block(PlotGrid grid, PlotSurface surface, At at) {
    int x = at.x();
    int y = at.y();
    int z = at.z();
    var column = grid.columnAt(x, z);
    if (column == PlotColumn.ROAD) {
      return grid.generated(x, y, z);
    }
    if (y == PlotGrid.SURFACE_Y && column == PlotColumn.FLOOR && surface.floor().isPresent()) {
      return surface.floor().orElseThrow();
    }
    if (y == PlotGrid.SURFACE_Y && column == PlotColumn.WALL && surface.wall().isPresent()) {
      return surface.wall().orElseThrow();
    }
    return grid.generated(x, y, z);
  }

  /** Biome a clear applies. Empty stays plains. */
  public static String biome(PlotSurface surface) {
    return surface.biome().orElse("minecraft:plains");
  }

  /**
   * Whether every block in {@code bounds} from {@code minY} through {@code maxY} is the generator
   * state. Stored floor, wall, and biome choices are not part of that template.
   */
  public static boolean matchesTemplate(
      PlotGrid grid, PlotBounds bounds, Band band, States blocks) {
    if (band.minY() > band.maxY()) {
      throw new IllegalArgumentException("build height is inverted");
    }
    for (int x = bounds.minX(); x <= bounds.maxX(); x++) {
      for (int z = bounds.minZ(); z <= bounds.maxZ(); z++) {
        for (int y = band.minY(); y <= band.maxY(); y++) {
          if (!blocks.at(x, y, z).equals(grid.generated(x, y, z))) {
            return false;
          }
        }
      }
    }
    return true;
  }
}
