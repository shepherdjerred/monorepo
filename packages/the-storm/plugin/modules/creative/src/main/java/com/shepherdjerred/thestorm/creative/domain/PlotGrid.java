package com.shepherdjerred.thestorm.creative.domain;

import java.util.Optional;

/**
 * Square plot grid measured on the 10 January 2016 creative snapshot.
 *
 * <p>Each cell is {@code plotWidth + roadWidth} blocks. The road is the band where a local
 * coordinate is outside the plot; an even road puts one extra block on the negative side so the
 * center line sits on the chunk boundary the way that world was generated. Plot ids use truncating
 * division, so the cell that contains the origin's north-west neighbour is {@code 0;0} and its
 * south-east corner is {@code -6,-6}.
 */
public final class PlotGrid {

  /** Claim width, wall included. The grass floor inside the wall is 80. */
  public static final int PLOT_WIDTH = 82;

  /** Nether-brick and glowstone road between plots. */
  public static final int ROAD_WIDTH = 10;

  public static final int ROAD_OFFSET_X = 0;

  public static final int ROAD_OFFSET_Z = 0;

  /** Grass, wall and road surface. Fill is stone or quartz below this. */
  public static final int SURFACE_Y = 64;

  /** Feet of the 2016 spawn, on the glowstone crossing at the origin. */
  public static final int SPAWN_X = -1;

  public static final int SPAWN_Y = 65;

  public static final int SPAWN_Z = -1;

  /**
   * World-border diameter that contains every saved region, from block {@code -3072,-4608} through
   * {@code 5631,3071}. This records archive extent; the playable border is configured separately.
   */
  public static final double SURVEYED_BORDER_SIZE = 8704;

  public static final double SURVEYED_BORDER_CENTER_X = 1280;

  public static final double SURVEYED_BORDER_CENTER_Z = -768;

  private static final String BEDROCK = "minecraft:bedrock";
  private static final String STONE = "minecraft:stone";
  private static final String QUARTZ = "minecraft:quartz_block";
  private static final String GRASS = "minecraft:grass_block";
  private static final String WALL_TOP =
      "minecraft:stone_brick_slab[type=bottom,waterlogged=false]";
  private static final String AIR = "minecraft:air";

  private final int plotWidth;
  private final int roadWidth;
  private final int offsetX;
  private final int offsetZ;
  private final int size;
  private final int pathWidthLower;

  private PlotGrid(int plotWidth, int roadWidth, int offsetX, int offsetZ) {
    if (plotWidth < 1 || roadWidth < 1) {
      throw new IllegalArgumentException("plot and road widths must be positive");
    }
    this.plotWidth = plotWidth;
    this.roadWidth = roadWidth;
    this.offsetX = offsetX;
    this.offsetZ = offsetZ;
    this.size = plotWidth + roadWidth;
    this.pathWidthLower = roadWidth % 2 == 0 ? roadWidth / 2 - 1 : roadWidth / 2;
  }

  /** The grid fitted to the recovered world. */
  public static PlotGrid recovered() {
    return new PlotGrid(PLOT_WIDTH, ROAD_WIDTH, ROAD_OFFSET_X, ROAD_OFFSET_Z);
  }

  public int size() {
    return size;
  }

  /** Local x inside the repeated cell. */
  public int cellX(int x) {
    return local(x, offsetX);
  }

  /** Local z inside the repeated cell. */
  public int cellZ(int z) {
    return local(z, offsetZ);
  }

  public int plotWidth() {
    return plotWidth;
  }

  /** Plot id of the cell containing {@code (x, z)}, including a road column. */
  public PlotId cellId(int x, int z) {
    return new PlotId(index(x, offsetX), index(z, offsetZ));
  }

  /** Plot under {@code (x, z)}, or empty when that column is road. */
  public Optional<PlotId> plotAt(int x, int z) {
    if (road(local(x, offsetX)) || road(local(z, offsetZ))) {
      return Optional.empty();
    }
    return Optional.of(new PlotId(index(x, offsetX), index(z, offsetZ)));
  }

  /** Inclusive footprint of {@code id}. */
  public PlotBounds bounds(PlotId id) {
    int halfRoad = roadWidth / 2;
    return new PlotBounds(
        id,
        offsetX + id.x() * size - plotWidth - halfRoad,
        offsetX + id.x() * size - halfRoad - 1,
        offsetZ + id.z() * size - plotWidth - halfRoad,
        offsetZ + id.z() * size - halfRoad - 1);
  }

  /**
   * Where a player stands to be home on {@code id}: the center column, feet on the surface. This is
   * one block above {@link #SURFACE_Y}, the same height as the glowstone crossing.
   */
  public PlotHome home(PlotId id) {
    var bounds = bounds(id);
    return new PlotHome(
        center(bounds.minX(), bounds.maxX()), SPAWN_Y, center(bounds.minZ(), bounds.maxZ()));
  }

  /** Feet on the center of a plot. */
  public record PlotHome(double x, double y, double z) {}

  private static double center(int min, int max) {
    return Math.floorDiv(min + max, 2) + 0.5;
  }

  /** Road, wall or floor at {@code (x, z)}. */
  public PlotColumn columnAt(int x, int z) {
    int lx = local(x, offsetX);
    int lz = local(z, offsetZ);
    if (road(lx) || road(lz)) {
      return PlotColumn.ROAD;
    }
    if (lx == pathWidthLower + 1
        || lx == pathWidthLower + plotWidth
        || lz == pathWidthLower + 1
        || lz == pathWidthLower + plotWidth) {
      return PlotColumn.WALL;
    }
    return PlotColumn.FLOOR;
  }

  /**
   * Block the generator places where the captured road decoration does not override it. Names are
   * modern block states. Air is the absence of a decoration.
   */
  public String generated(int x, int y, int z) {
    if (y == 0) {
      return BEDROCK;
    }
    var column = columnAt(x, z);
    if (y >= 1 && y < SURFACE_Y) {
      return column == PlotColumn.ROAD ? QUARTZ : STONE;
    }
    if (y == SURFACE_Y && column == PlotColumn.FLOOR) {
      return GRASS;
    }
    if (y == SURFACE_Y && column == PlotColumn.WALL) {
      return STONE;
    }
    if (y == SURFACE_Y + 1 && column == PlotColumn.WALL) {
      return WALL_TOP;
    }
    return AIR;
  }

  private boolean road(int local) {
    return local <= pathWidthLower || local > pathWidthLower + plotWidth;
  }

  /**
   * Position inside the repeated cell, always {@code 0 .. size-1}. An exact negative multiple has
   * remainder {@code 0}; adding the cell size there would land one past the last local.
   */
  private int local(int block, int offset) {
    int mod = (block - offset) % size;
    return mod < 0 ? mod + size : mod;
  }

  private int index(int block, int offset) {
    int shifted = block - offset;
    if (shifted < 0) {
      return shifted / size;
    }
    return shifted / size + 1;
  }
}
