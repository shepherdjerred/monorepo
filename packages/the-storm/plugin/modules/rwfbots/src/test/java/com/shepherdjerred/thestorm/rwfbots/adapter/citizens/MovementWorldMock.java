package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.WorldCreator;
import org.bukkit.entity.Player;
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

  boolean collides(Player actor, BoundingBox body) {
    return collides(
        body,
        new CollisionContext(
            java.util.Objects.requireNonNull(
                    actor.getLocation(), "a spawned collision fixture has a location")
                .getY(),
            actor.isSneaking()
                || actor.getInventory().getItemInMainHand().getType() == Material.SCAFFOLDING));
  }

  boolean collides(BoundingBox body) {
    return collides(body, new CollisionContext(body.getMinY(), false));
  }

  private record CollisionContext(double currentFeet, boolean restrictedScaffoldInput) {}

  private boolean collides(BoundingBox body, CollisionContext context) {
    for (var x = (int) Math.floor(body.getMinX()); x < Math.ceil(body.getMaxX()); x++) {
      for (var y = (int) Math.floor(body.getMinY()); y < Math.ceil(body.getMaxY()); y++) {
        for (var z = (int) Math.floor(body.getMinZ()); z < Math.ceil(body.getMaxZ()); z++) {
          var block = (CollisionBlock) getBlockAt(x, y, z);
          if (block.collides(body, context)) return true;
        }
      }
    }
    return false;
  }

  private static final class CollisionBlock extends BlockMock {
    CollisionBlock(Location at) {
      super(Material.AIR, at);
    }

    @Override
    public boolean isPassable() {
      return switch (getType()) {
        case AIR, FIRE, WATER, LAVA, LADDER -> true;
        case STONE, MAGMA_BLOCK, SCAFFOLDING -> false;
        default -> throw new IllegalStateException("terrain fixture does not model " + getType());
      };
    }

    @Override
    public BoundingBox getBoundingBox() {
      var size = isPassable() ? 0 : 1;
      return new BoundingBox(getX(), getY(), getZ(), getX() + size, getY() + size, getZ() + size);
    }

    boolean collides(BoundingBox body, CollisionContext context) {
      if (getType() != Material.SCAFFOLDING)
        return !isPassable() && getBoundingBox().overlaps(body);
      if (context.restrictedScaffoldInput())
        throw new IllegalStateException("native scaffold fixture models ordinary climbing input");
      // Native scaffold collision is empty inside/below the cell; its top catches a body above it.
      return context.currentFeet() >= getY() + 1
          && new BoundingBox(getX(), getY() + 0.875, getZ(), getX() + 1, getY() + 1, getZ() + 1)
              .overlaps(body);
    }
  }
}
