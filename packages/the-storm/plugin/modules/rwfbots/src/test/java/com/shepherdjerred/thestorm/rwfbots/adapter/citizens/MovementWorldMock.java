package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.WorldCreator;
import org.bukkit.util.BoundingBox;
import org.mockbukkit.mockbukkit.block.BlockMock;
import org.mockbukkit.mockbukkit.world.Coordinate;
import org.mockbukkit.mockbukkit.world.WorldMock;

/** Exact collision shapes for the full blocks and non-colliding fluids/fire in terrain fixtures. */
final class MovementWorldMock extends WorldMock {
  private final java.util.Map<Coordinate, BlockMock> cells = new java.util.HashMap<>();

  MovementWorldMock() {
    super(new WorldCreator("terrain"));
  }

  @Override
  public BlockMock createBlock(Coordinate at) {
    return cells.computeIfAbsent(
        at, point -> new CollisionBlock(new Location(this, point.x, point.y, point.z)));
  }

  private static final class CollisionBlock extends BlockMock {
    CollisionBlock(Location at) {
      super(Material.AIR, at);
    }

    @Override
    public boolean isPassable() {
      return switch (getType()) {
        case AIR, FIRE, WATER, LAVA, LADDER -> true;
        case STONE, MAGMA_BLOCK -> false;
        default -> throw new IllegalStateException("terrain fixture does not model " + getType());
      };
    }

    @Override
    public BoundingBox getBoundingBox() {
      var size = isPassable() ? 0 : 1;
      return new BoundingBox(getX(), getY(), getZ(), getX() + size, getY() + size, getZ() + size);
    }
  }
}
