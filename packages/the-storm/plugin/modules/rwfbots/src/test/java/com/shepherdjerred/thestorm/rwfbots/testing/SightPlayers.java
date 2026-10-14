package com.shepherdjerred.thestorm.rwfbots.testing;

import org.bukkit.entity.Entity;
import org.bukkit.entity.LivingEntity;
import org.bukkit.util.BlockIterator;
import org.bukkit.util.BoundingBox;
import org.mockbukkit.mockbukkit.ServerMock;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** Human viewers with exact eye rays through the full-cube blocks used by the bot fixtures. */
public final class SightPlayers {
  private SightPlayers() {}

  public static PlayerMock add(ServerMock server, String name) {
    var player = new SightPlayer(server, name);
    server.addPlayer(player);
    return player;
  }

  private static final class SightPlayer
      extends com.shepherdjerred.thestorm.rwfbots.adapter.paper.TraversalPlayerMock {
    SightPlayer(ServerMock server, String name) {
      super(server, name, java.util.UUID.randomUUID());
    }

    @Override
    public boolean hasLineOfSight(Entity target) {
      if (!getWorld().equals(target.getWorld())) return false;
      var from = getEyeLocation().toVector();
      var end =
          target instanceof LivingEntity living ? living.getEyeLocation() : target.getLocation();
      var difference = end.toVector().subtract(from);
      var distance = difference.length();
      if (distance < 1.0e-6) return true;
      var direction = difference.normalize();
      var ray = new BlockIterator(getWorld(), from, direction, 0, (int) Math.ceil(distance));
      while (ray.hasNext()) {
        var block = ray.next();
        if (!blocksSight(block.getType())) continue;
        var cube =
            new BoundingBox(
                block.getX(),
                block.getY(),
                block.getZ(),
                block.getX() + 1,
                block.getY() + 1,
                block.getZ() + 1);
        if (cube.rayTrace(from, direction, distance) != null) return false;
      }
      return true;
    }

    private static boolean blocksSight(org.bukkit.Material material) {
      return switch (material) {
        case AIR, CAVE_AIR, VOID_AIR, FIRE, WATER, LAVA -> false;
        case STONE, GLASS, MAGMA_BLOCK -> true;
        default -> throw new IllegalStateException("viewer fixture does not model " + material);
      };
    }
  }
}
