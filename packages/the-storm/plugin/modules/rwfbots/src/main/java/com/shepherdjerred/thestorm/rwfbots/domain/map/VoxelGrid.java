package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import java.util.BitSet;
import java.util.Optional;

/**
 * Three bit layers over the map's cells: what stops walking, what stops seeing, what stops arrows.
 * Cells outside the bounds stop walking and nothing else.
 *
 * @param bounds the cuboid covered
 * @param movement cells a player cannot occupy
 * @param sight cells that hide what is behind them
 * @param projectile cells that stop arrows
 */
public record VoxelGrid(GridBounds bounds, BitSet movement, BitSet sight, BitSet projectile) {

  /** Which layer a query asks about. */
  public enum Layer {
    MOVEMENT,
    SIGHT,
    PROJECTILE
  }

  public VoxelGrid {
    movement = (BitSet) movement.clone();
    sight = (BitSet) sight.clone();
    projectile = (BitSet) projectile.clone();
    var volume = bounds.volume();
    if (movement.length() > volume || sight.length() > volume || projectile.length() > volume) {
      throw new IllegalArgumentException("bit layers extend past the bounds");
    }
  }

  /** The grid of {@code blocks}. */
  public static VoxelGrid from(BlockClassification blocks) {
    var bounds = blocks.bounds();
    var movement = new BitSet(bounds.volume());
    var sight = new BitSet(bounds.volume());
    var projectile = new BitSet(bounds.volume());
    var origin = bounds.origin();
    for (var y = 0; y < bounds.sizeY(); y++) {
      for (var z = 0; z < bounds.sizeZ(); z++) {
        for (var x = 0; x < bounds.sizeX(); x++) {
          var wx = origin.x() + x;
          var wy = origin.y() + y;
          var wz = origin.z() + z;
          var index = bounds.index(wx, wy, wz);
          var shape = blocks.shape(wx, wy, wz);
          movement.set(index, shape.blocksMovement());
          projectile.set(index, shape.blocksProjectile());
          sight.set(index, blocks.blocksSight(wx, wy, wz));
        }
      }
    }
    return new VoxelGrid(bounds, movement, sight, projectile);
  }

  public boolean blocks(int x, int y, int z, Layer layer) {
    if (!bounds.contains(x, y, z)) {
      return layer == Layer.MOVEMENT;
    }
    var index = bounds.index(x, y, z);
    return switch (layer) {
      case MOVEMENT -> movement.get(index);
      case SIGHT -> sight.get(index);
      case PROJECTILE -> projectile.get(index);
    };
  }

  public boolean blocks(BlockPos cell, Layer layer) {
    return blocks(cell.x(), cell.y(), cell.z(), layer);
  }

  public boolean blocksMovement(BlockPos cell) {
    return blocks(cell, Layer.MOVEMENT);
  }

  /** Whether a straight line from {@code from} to {@code to} crosses nothing that blocks sight. */
  public boolean canSee(Vec3 from, Vec3 to) {
    return raycast(from, to, Layer.SIGHT).isEmpty();
  }

  /**
   * The first cell on the segment from {@code from} to {@code to} that blocks {@code layer}, or
   * empty if the whole segment is clear. Walks the cells the segment crosses (Amanatides and Woo),
   * so the cost is a few nanoseconds per cell.
   */
  public Optional<BlockPos> raycast(Vec3 from, Vec3 to, Layer layer) {
    var walker = new RayWalker(from, to);
    if (blocks(walker.x, walker.y, walker.z, layer)) {
      return Optional.of(new BlockPos(walker.x, walker.y, walker.z));
    }
    while (walker.advance()) {
      if (blocks(walker.x, walker.y, walker.z, layer)) {
        return Optional.of(new BlockPos(walker.x, walker.y, walker.z));
      }
    }
    return Optional.empty();
  }

  /** The cell stepping state of one ray. */
  private static final class RayWalker {
    int x;
    int y;
    int z;
    private final int stepX;
    private final int stepY;
    private final int stepZ;
    private final double deltaX;
    private final double deltaY;
    private final double deltaZ;
    private double maxX;
    private double maxY;
    private double maxZ;

    RayWalker(Vec3 from, Vec3 to) {
      x = (int) Math.floor(from.x());
      y = (int) Math.floor(from.y());
      z = (int) Math.floor(from.z());
      var dx = to.x() - from.x();
      var dy = to.y() - from.y();
      var dz = to.z() - from.z();
      stepX = (int) Math.signum(dx);
      stepY = (int) Math.signum(dy);
      stepZ = (int) Math.signum(dz);
      deltaX = stepX == 0 ? Double.POSITIVE_INFINITY : Math.abs(1 / dx);
      deltaY = stepY == 0 ? Double.POSITIVE_INFINITY : Math.abs(1 / dy);
      deltaZ = stepZ == 0 ? Double.POSITIVE_INFINITY : Math.abs(1 / dz);
      maxX = firstCrossing(from.x(), x, stepX, deltaX);
      maxY = firstCrossing(from.y(), y, stepY, deltaY);
      maxZ = firstCrossing(from.z(), z, stepZ, deltaZ);
    }

    private static double firstCrossing(double start, int cell, int step, double delta) {
      if (step == 0) {
        return Double.POSITIVE_INFINITY;
      }
      var toBoundary = step > 0 ? cell + 1 - start : start - cell;
      return toBoundary * delta;
    }

    /** Moves into the next cell; false once the segment ends before the next boundary. */
    boolean advance() {
      if (maxX < maxY && maxX < maxZ) {
        if (maxX > 1) {
          return false;
        }
        x += stepX;
        maxX += deltaX;
      } else if (maxY < maxZ) {
        if (maxY > 1) {
          return false;
        }
        y += stepY;
        maxY += deltaY;
      } else {
        if (maxZ > 1) {
          return false;
        }
        z += stepZ;
        maxZ += deltaZ;
      }
      return true;
    }
  }
}
