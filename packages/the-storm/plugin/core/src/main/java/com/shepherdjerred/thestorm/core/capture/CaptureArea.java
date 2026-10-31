package com.shepherdjerred.thestorm.core.capture;

import java.util.UUID;

/** A small, explicit fixture envelope. */
public record CaptureArea(
    String world, UUID worldId, int minX, int minY, int minZ, int maxX, int maxY, int maxZ) {
  public CaptureArea {
    if (minX > maxX
        || minY > maxY
        || minZ > maxZ
        || ((long) maxX - minX + 1) * ((long) maxY - minY + 1) * ((long) maxZ - minZ + 1) > 32768)
      throw new IllegalArgumentException("Capture area is invalid or exceeds 32768 blocks");
  }

  public boolean contains(int x, int y, int z) {
    return x >= minX && x <= maxX && y >= minY && y <= maxY && z >= minZ && z <= maxZ;
  }

  public boolean contains(String name, int x, int y, int z) {
    return world.equals(name) && contains(x, y, z);
  }

  public boolean contains(UUID id, int x, int y, int z) {
    return worldId.equals(id) && contains(x, y, z);
  }
}
