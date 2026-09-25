package com.shepherdjerred.thestorm.arena.adapter.paper;

import com.shepherdjerred.thestorm.arena.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import com.shepherdjerred.thestorm.arena.domain.geometry.Spot;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;

/** Conversions between the arena's geometry and Bukkit locations. */
final class Places {

  private Places() {}

  /**
   * Where {@code entity} is. Takes an {@link Entity} so a player resolves to the entity's non-null
   * location rather than {@code OfflinePlayer}'s nullable one.
   */
  static Location at(Entity entity) {
    return entity.getLocation();
  }

  static Location location(World world, Spot spot) {
    return new Location(world, spot.x(), spot.y(), spot.z(), spot.yaw(), spot.pitch());
  }

  static Location location(World world, Point point) {
    return new Location(world, point.x(), point.y(), point.z());
  }

  static Block block(World world, BlockPos pos) {
    return world.getBlockAt(pos.x(), pos.y(), pos.z());
  }

  static Point point(Location location) {
    return new Point(location.getX(), location.getY(), location.getZ());
  }

  static BlockPos pos(Block block) {
    return new BlockPos(block.getX(), block.getY(), block.getZ());
  }

  static Spot spot(Location location) {
    return new Spot(
        round(location.getX()),
        round(location.getY()),
        round(location.getZ()),
        (float) round(wrap(location.getYaw())),
        (float) round(location.getPitch()));
  }

  private static double round(double value) {
    return Math.round(value * 10) / 10.0;
  }

  private static double wrap(float yaw) {
    return ((yaw + 180.0) % 360 + 360) % 360 - 180;
  }
}
