package com.shepherdjerred.thestorm.shops.app;

import java.util.UUID;
import java.util.concurrent.CompletableFuture;

/** Explicit snapshot/remove/restore port for eviction recovery; main thread only. */
public interface ShopRelocation {
  record Area(UUID world, int minX, int minY, int minZ, int maxX, int maxY, int maxZ) {
    public boolean contains(UUID world, int x, int y, int z) {
      return this.world.equals(world)
          && x >= minX
          && x <= maxX
          && y >= minY
          && y <= maxY
          && z >= minZ
          && z <= maxZ;
    }
  }

  record Target(UUID world, int offsetX, int offsetY, int offsetZ) {}

  boolean idle(Area area);

  byte[] snapshot(Area area, UUID owner);

  void validateRestore(UUID owner, byte[] snapshot);

  CompletableFuture<Void> remove(byte[] snapshot);

  CompletableFuture<Void> restore(byte[] snapshot, Target target);

  CompletableFuture<Void> removePlaced(byte[] snapshot, Target target);
}
