package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.rwf.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Spawn;
import com.shepherdjerred.thestorm.rwf.domain.geometry.Vec3;
import org.bukkit.Location;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Entity;
import org.bukkit.util.Vector;

/** Conversions between the rules' geometry and Bukkit locations. */
final class Places {

  private Places() {}

  /**
   * Where {@code entity} is. Takes an {@link Entity} so a player resolves to the entity's non-null
   * location rather than {@code OfflinePlayer}'s nullable one.
   */
  static Location at(Entity entity) {
    return entity.getLocation();
  }

  static Location location(World world, Spawn spawn) {
    var p = spawn.position();
    return new Location(world, p.x(), p.y(), p.z(), spawn.yaw(), spawn.pitch());
  }

  static Location location(World world, Vec3 point) {
    return new Location(world, point.x(), point.y(), point.z());
  }

  /** The centre of {@code pos}. */
  static Location center(World world, BlockPos pos) {
    return new Location(world, pos.x() + 0.5, pos.y() + 0.5, pos.z() + 0.5);
  }

  static Block block(World world, BlockPos pos) {
    return world.getBlockAt(pos.x(), pos.y(), pos.z());
  }

  static Vec3 vec(Location location) {
    return new Vec3(location.getX(), location.getY(), location.getZ());
  }

  static Vec3 vec(Vector vector) {
    return new Vec3(vector.getX(), vector.getY(), vector.getZ());
  }

  static Vector vector(Vec3 vec) {
    return new Vector(vec.x(), vec.y(), vec.z());
  }

  static BlockPos pos(Block block) {
    return new BlockPos(block.getX(), block.getY(), block.getZ());
  }

  static BlockPos pos(Location location) {
    return new BlockPos(location.getBlockX(), location.getBlockY(), location.getBlockZ());
  }
}
