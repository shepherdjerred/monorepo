package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Cuboid;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
import org.bukkit.plugin.Plugin;

/** Small reversible course inside the actual private Training Yard, preserving owned assets. */
final class HealthCourse implements AutoCloseable {
  private final World world;
  private final Plugin plugin;
  private final boolean water;
  private final Map<Block, BlockData> original = new LinkedHashMap<>();

  HealthCourse(World world, Plugin plugin, Cuboid border, boolean water) {
    if (!border.contains(new BlockPos(20, 64, 5))
        || !border.contains(new BlockPos(29, 76, 8))
        || world.getMinHeight() > 64
        || world.getMaxHeight() <= 76)
      throw new IllegalStateException("health course does not fit the original map/world");
    this.world = world;
    this.plugin = plugin;
    this.water = water;
    for (var x = 20; x <= 29; x++) {
      world.addPluginChunkTicket(x >> 4, 0, plugin);
      for (var z = 5; z <= 8; z++) {
        for (var y = 64; y <= 76; y++) prepare(world.getBlockAt(x, y, z));
      }
    }
  }

  private void prepare(Block block) {
    original.put(block, block.getBlockData());
    var platform = block.getY() == 72 && block.getX() <= 22;
    var basin = water && block.getX() >= 23 && block.getY() >= 65 && block.getY() <= 67;
    block.setType(
        block.getY() == 64 || platform ? Material.STONE : basin ? Material.WATER : Material.AIR,
        false);
  }

  Location start() {
    return new Location(world, 22.4, 73, 6.5, -90, 0);
  }

  Waypoint landing() {
    return new Waypoint(
        new Vec3(25.5, 65, 6.5),
        Hop.DROP,
        Optional.empty(),
        water ? Waypoint.Landing.WATER : Waypoint.Landing.GROUND);
  }

  Map<String, String> evidence() {
    return Map.of(
        "bounds",
        "20,64,5:29,76,8",
        "start",
        "22.4,73,6.5",
        "landing",
        "25.5,65,6.5",
        "landingKind",
        water ? "water" : "ground",
        "platform",
        world.getBlockAt(22, 72, 6).getBlockData().getAsString(),
        "belowLanding",
        world.getBlockAt(25, 64, 6).getBlockData().getAsString(),
        "landingBlock",
        world.getBlockAt(25, 65, 6).getBlockData().getAsString(),
        "ownedAssetsWritten",
        "false");
  }

  void release(org.bukkit.entity.Player player) {
    var support = original.get(world.getBlockAt(20, 64, 6));
    var feet = original.get(world.getBlockAt(20, 65, 6));
    var head = original.get(world.getBlockAt(20, 66, 6));
    if (support == null
        || feet == null
        || head == null
        || !support.getMaterial().isSolid()
        || !feet.getMaterial().isAir()
        || !head.getMaterial().isAir())
      throw new IllegalStateException("original course release cell is not supported and clear");
    if (!player.teleport(new Location(world, 20.5, 65, 6.5)))
      throw new IllegalStateException("course release teleport refused");
    player.setVelocity(new org.bukkit.util.Vector());
    player.setFallDistance(0);
  }

  @Override
  public void close() {
    original.forEach((block, data) -> block.setBlockData(data, false));
    original.clear();
    world.removePluginChunkTicket(1, 0, plugin);
  }
}
