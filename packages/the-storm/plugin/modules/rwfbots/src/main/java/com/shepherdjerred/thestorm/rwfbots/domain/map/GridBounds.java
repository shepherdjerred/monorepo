package com.shepherdjerred.thestorm.rwfbots.domain.map;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;

/**
 * The cuboid of cells a map covers.
 *
 * @param origin the lowest corner cell
 * @param sizeX cells along x
 * @param sizeY cells along y
 * @param sizeZ cells along z
 */
public record GridBounds(BlockPos origin, int sizeX, int sizeY, int sizeZ) {

  public GridBounds {
    if (sizeX <= 0 || sizeY <= 0 || sizeZ <= 0) {
      throw new IllegalArgumentException("sizes must be positive");
    }
    if ((long) sizeX * sizeY * sizeZ > Integer.MAX_VALUE) {
      throw new IllegalArgumentException("grid too large");
    }
  }

  public int volume() {
    return sizeX * sizeY * sizeZ;
  }

  public boolean contains(int x, int y, int z) {
    var lx = x - origin.x();
    var ly = y - origin.y();
    var lz = z - origin.z();
    return lx >= 0 && lx < sizeX && ly >= 0 && ly < sizeY && lz >= 0 && lz < sizeZ;
  }

  public boolean contains(BlockPos cell) {
    return contains(cell.x(), cell.y(), cell.z());
  }

  /** The dense index of a cell inside the bounds. */
  public int index(int x, int y, int z) {
    if (!contains(x, y, z)) {
      throw new IllegalArgumentException("outside bounds: " + x + ", " + y + ", " + z);
    }
    return ((y - origin.y()) * sizeZ + (z - origin.z())) * sizeX + (x - origin.x());
  }

  public int index(BlockPos cell) {
    return index(cell.x(), cell.y(), cell.z());
  }

  /** The cell at dense index {@code index}. */
  public BlockPos cell(int index) {
    if (index < 0 || index >= volume()) {
      throw new IllegalArgumentException("index out of range: " + index);
    }
    var x = index % sizeX;
    var rest = index / sizeX;
    var z = rest % sizeZ;
    var y = rest / sizeZ;
    return new BlockPos(origin.x() + x, origin.y() + y, origin.z() + z);
  }
}
