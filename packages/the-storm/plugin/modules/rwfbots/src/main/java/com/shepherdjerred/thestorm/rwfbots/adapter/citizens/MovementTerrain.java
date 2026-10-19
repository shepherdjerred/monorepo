package com.shepherdjerred.thestorm.rwfbots.adapter.citizens;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.AABB;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.MovementSafety;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.Set;
import java.util.function.Predicate;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.block.data.Lightable;
import org.bukkit.util.BoundingBox;

/**
 * Reads current terrain immediately before motion, including hazards created after the map bake.
 */
final class MovementTerrain implements MovementSafety.Terrain {
  private static final double EPSILON = 0.001;
  // Just inside the body's half width, so a footprint corner never samples the next cell over.
  private static final double FOOTPRINT = 0.29;
  private static final Set<Material> HAZARDS =
      Set.of(
          Material.LAVA,
          Material.FIRE,
          Material.SOUL_FIRE,
          Material.CACTUS,
          Material.MAGMA_BLOCK,
          Material.SWEET_BERRY_BUSH,
          Material.WITHER_ROSE,
          Material.POWDER_SNOW);

  private final World world;
  private final Optional<GridBounds> bounds;
  private final Predicate<BoundingBox> collisions;
  private final boolean standing;

  MovementTerrain(
      World world,
      Optional<GridBounds> bounds,
      Predicate<BoundingBox> collisions,
      boolean standing) {
    this.world = world;
    this.bounds = bounds;
    this.collisions = collisions;
    this.standing = standing;
  }

  @Override
  public boolean clear(Vec3 feet) {
    return inside(feet) && !collisions.test(box(feet));
  }

  @Override
  public boolean hazardous(Vec3 feet) {
    var body = box(feet);
    body.expand(0, 0.1, 0);
    return any(body, MovementTerrain::hazard);
  }

  @Override
  public boolean inside(Vec3 feet) {
    var body = AABB.playerAt(feet, false);
    var min = BlockPos.of(body.min().plus(EPSILON, EPSILON, EPSILON));
    var max = BlockPos.of(body.max().plus(-EPSILON, -EPSILON, -EPSILON));
    return feet.y() >= world.getMinHeight()
        && body.max().y() <= world.getMaxHeight()
        && loaded(min)
        && loaded(max)
        && bounds.map(limit -> limit.contains(min) && limit.contains(max)).orElse(true);
  }

  @Override
  public boolean supported(Vec3 feet, double drop) {
    var cell = block(BlockPos.of(feet));
    if (water(cell) || Tag.CLIMBABLE.isTagged(cell.getType())) return true;
    var westNorth = supportAt(feet.plus(-0.25, 0, -0.25), drop, true);
    var eastSouth = supportAt(feet.plus(0.25, 0, 0.25), drop, true);
    var westSouth = supportAt(feet.plus(-0.25, 0, 0.25), drop, true);
    var eastNorth = supportAt(feet.plus(0.25, 0, -0.25), drop, true);
    // Floor under a diagonal pair of corners holds a body crossing between blocks that touch only
    // at a corner (a diagonal wall walked along its top); an edge with one side over the void
    // still does not count.
    return (westNorth && eastSouth) || (westSouth && eastNorth);
  }

  @Override
  public boolean grounded(Vec3 feet) {
    if (standing && supportAt(feet, EPSILON, false)) return true;
    // A body whose footprint rests on a block edge is standing, though nothing is under its
    // centre: vanilla holds it up, and treating the spot as floorless refused every way off it.
    for (var dx : new double[] {-FOOTPRINT, FOOTPRINT}) {
      for (var dz : new double[] {-FOOTPRINT, FOOTPRINT}) {
        if (supportAt(feet.plus(dx, 0, dz), EPSILON, false)) return true;
      }
    }
    return false;
  }

  private boolean supportAt(Vec3 point, double drop, boolean allowWater) {
    var top = BlockPos.of(point.plus(0, -EPSILON, 0));
    var bottom = (int) Math.floor(point.y() - drop);
    for (var y = top.y(); y >= bottom; y--) {
      var floor = block(new BlockPos(top.x(), y, top.z()));
      if (water(floor)) return allowWater;
      if (!floor.isPassable() && !hazard(floor)) {
        var surface = topUnder(floor, point);
        if (surface.isEmpty()) continue;
        return surface.getAsDouble() <= point.y() + EPSILON
            && surface.getAsDouble() >= point.y() - drop;
      }
    }
    return false;
  }

  boolean inWater(Vec3 feet) {
    return water(block(BlockPos.of(feet)))
        || water(block(BlockPos.of(feet.plus(0, -0.1, 0))))
        || water(block(BlockPos.of(feet.plus(0, 1.62, 0))));
  }

  @Override
  public boolean climbable(Vec3 feet) {
    return Tag.CLIMBABLE.isTagged(block(BlockPos.of(feet)).getType())
        || Tag.CLIMBABLE.isTagged(block(BlockPos.of(feet.plus(0, 1, 0))).getType());
  }

  /** Occupied destination contact, with no fall-immunity credit for water below dry feet. */
  Waypoint.Landing landing(Vec3 feet) {
    if (water(block(BlockPos.of(feet)))) return Waypoint.Landing.WATER;
    return climbable(feet) ? Waypoint.Landing.CLIMB : Waypoint.Landing.GROUND;
  }

  /** Includes the last fraction of a block above the chosen supported landing. */
  Vec3 contact(Vec3 feet) {
    if (landing(feet) != Waypoint.Landing.GROUND) return feet;
    var height = feet.y();
    for (var dx : new double[] {-0.25, 0.25}) {
      for (var dz : new double[] {-0.25, 0.25}) {
        height = Math.min(height, contactHeight(feet.plus(dx, 0, dz)));
      }
    }
    return feet.withY(height);
  }

  private double contactHeight(Vec3 feet) {
    var cell = BlockPos.of(feet.plus(0, -EPSILON, 0));
    var bottom = (int) Math.floor(feet.y() - 1.1);
    for (var y = cell.y(); y >= bottom; y--) {
      var floor = block(new BlockPos(cell.x(), y, cell.z()));
      if (water(floor)) return Math.min(feet.y(), y + 1.0);
      if (!floor.isPassable() && !hazard(floor)) {
        var surface = topUnder(floor, feet);
        if (surface.isPresent()) return Math.min(feet.y(), surface.getAsDouble());
      }
    }
    throw new IllegalStateException(
        "Chosen ground movement must have a supported contact: " + feet);
  }

  /** A nearby dry bank, including its whole landing footprint, never the open water surface. */
  Optional<Vec3> bankExit(Vec3 from, Vec3 target) {
    var heading = target.minus(from).horizontal();
    if (heading.isZero()) return Optional.empty();
    var direction = heading.normalized();
    var height = Math.floor(from.y()) + 1;
    for (var distance = 0.4; distance <= Math.min(1.4, heading.length()); distance += 0.2) {
      var bank = from.plus(direction.scale(distance)).withY(height);
      if (inside(bank) && clear(bank) && !hazardous(bank) && dryLanding(bank))
        return Optional.of(bank);
    }
    return Optional.empty();
  }

  private boolean dryLanding(Vec3 feet) {
    for (var dx : new double[] {-0.25, 0.25}) {
      for (var dz : new double[] {-0.25, 0.25}) {
        if (!supportAt(feet.plus(dx, 0, dz), 0.1, false)) return false;
      }
    }
    return true;
  }

  double waterSurface(Vec3 feet) {
    var cell = BlockPos.of(feet);
    if (!water(block(cell))) cell = cell.down();
    // Only local, loaded cells: deep immersion rises towards the next eight-block window.
    var top = Math.min(world.getMaxHeight() - 1, cell.y() + 8);
    while (cell.y() < top && water(block(cell.up()))) cell = cell.up();
    return cell.y() + 1.0;
  }

  private boolean any(BoundingBox box, Predicate<Block> predicate) {
    for (var x = (int) Math.floor(box.getMinX());
        x <= (int) Math.floor(box.getMaxX() - EPSILON);
        x++) {
      for (var y = (int) Math.floor(box.getMinY());
          y <= (int) Math.floor(box.getMaxY() - EPSILON);
          y++) {
        for (var z = (int) Math.floor(box.getMinZ());
            z <= (int) Math.floor(box.getMaxZ() - EPSILON);
            z++) {
          var cell = new BlockPos(x, y, z);
          if (!loaded(cell) || predicate.test(block(cell))) return true;
        }
      }
    }
    return false;
  }

  /**
   * The top of {@code block}'s collision under {@code point}'s column, from its actual collision
   * boxes rather than their union: a stair's union box is a full block high even over its low step,
   * so a body passing a stair or between slab and stair cells read as having no floor.
   */
  private static OptionalDouble topUnder(Block block, Vec3 point) {
    var top = Double.NEGATIVE_INFINITY;
    for (var box : block.getCollisionShape().getBoundingBoxes()) {
      var minX = block.getX() + box.getMinX();
      var maxX = block.getX() + box.getMaxX();
      var minZ = block.getZ() + box.getMinZ();
      var maxZ = block.getZ() + box.getMaxZ();
      if (point.x() >= minX && point.x() < maxX && point.z() >= minZ && point.z() < maxZ)
        top = Math.max(top, block.getY() + box.getMaxY());
    }
    return top == Double.NEGATIVE_INFINITY ? OptionalDouble.empty() : OptionalDouble.of(top);
  }

  private boolean loaded(BlockPos cell) {
    return world.isChunkLoaded(cell.x() >> 4, cell.z() >> 4);
  }

  private Block block(BlockPos cell) {
    return world.getBlockAt(cell.x(), cell.y(), cell.z());
  }

  private static boolean water(Block block) {
    return BodyFluids.containsWater(block);
  }

  private static boolean hazard(Block block) {
    if (HAZARDS.contains(block.getType())) return true;
    return (block.getType() == Material.CAMPFIRE || block.getType() == Material.SOUL_CAMPFIRE)
        && block.getBlockData() instanceof Lightable light
        && light.isLit();
  }

  /**
   * The body at {@code feet}, shrunk by {@link #EPSILON} at the feet and the head: as in vanilla,
   * touching a floor or a ceiling is not colliding with it. Only lifting the feet made a swimmer
   * whose head buoyancy had pressed against a ceiling collide where it already floated, so every
   * move read as blocked and it froze in place. Side faces keep their full extent, so a body flush
   * against a block still counts as touching it and does not step up onto stall counters or roofs
   * it could not climb down from.
   */
  private static BoundingBox box(Vec3 feet) {
    var body = AABB.playerAt(feet, false);
    return new BoundingBox(
        body.min().x(),
        body.min().y() + EPSILON,
        body.min().z(),
        body.max().x(),
        body.max().y() - EPSILON,
        body.max().z());
  }
}
