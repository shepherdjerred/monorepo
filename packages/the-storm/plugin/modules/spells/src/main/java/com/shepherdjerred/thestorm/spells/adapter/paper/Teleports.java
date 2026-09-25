package com.shepherdjerred.thestorm.spells.adapter.paper;

import com.shepherdjerred.thestorm.core.protection.ProtectedAction;
import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.spells.adapter.paper.spell.CastProblem;
import com.shepherdjerred.thestorm.spells.domain.Refusal;
import com.shepherdjerred.thestorm.spells.domain.geometry.BlockPos;
import com.shepherdjerred.thestorm.spells.domain.geometry.BlockProbe;
import com.shepherdjerred.thestorm.spells.domain.geometry.Footing;
import com.shepherdjerred.thestorm.spells.domain.geometry.SafeSpots;
import java.util.EnumSet;
import java.util.Set;
import java.util.function.Predicate;
import org.bukkit.FluidCollisionMode;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.Tag;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.event.player.PlayerTeleportEvent;

/**
 * Safe teleports. A spell teleports its caster only to a safe spot (solid ground, open room for
 * feet and head, nothing that burns, cuts or drowns) inside land where the caster may {@link
 * ProtectedAction#TELEPORT_INTO}.
 */
public final class Teleports {

  private static final Set<Material> HAZARDS =
      EnumSet.of(
          Material.LAVA,
          Material.MAGMA_BLOCK,
          Material.CACTUS,
          Material.SWEET_BERRY_BUSH,
          Material.WITHER_ROSE,
          Material.POWDER_SNOW,
          Material.POINTED_DRIPSTONE,
          Material.COBWEB);

  /** Where a traced path aims on a standing player: about their chest. */
  private static final double BODY_HEIGHT = 1.0;

  private static final double MIN_TRACE = 1.0e-3;

  private final Guard guard;

  public Teleports(Guard guard) {
    this.guard = guard;
  }

  /** How {@code world}'s blocks look to someone arriving. */
  public static BlockProbe probe(World world) {
    return pos -> footing(world, pos);
  }

  private static Footing footing(World world, BlockPos pos) {
    if (pos.y() < world.getMinHeight() || pos.y() >= world.getMaxHeight()) {
      return Footing.HAZARD;
    }
    var block = world.getBlockAt(pos.x(), pos.y(), pos.z());
    var type = block.getType();
    if (HAZARDS.contains(type)
        || Tag.FIRE.isTagged(type)
        || Tag.CAMPFIRES.isTagged(type)
        || block.isLiquid()) {
      return Footing.HAZARD;
    }
    if (block.isPassable()) {
      return Footing.OPEN;
    }
    return block.isSolid() ? Footing.SOLID : Footing.HAZARD;
  }

  /**
   * Where {@code caster} arrives when aiming for {@code wanted}: the nearest safe spot within
   * {@code radius}, facing the way {@code wanted} faces, if the caster may enter that land.
   */
  public Result<Location, CastProblem> arrival(Player caster, Location wanted, int radius) {
    return arrival(caster, wanted, radius, spot -> true);
  }

  /**
   * {@link #arrival(Player, Location, int)}, choosing only among spots {@code reachable} accepts
   * (given as the feet location of the spot, facing as {@code wanted} faces).
   */
  public Result<Location, CastProblem> arrival(
      Player caster, Location wanted, int radius, Predicate<Location> reachable) {
    var world = wanted.getWorld();
    var origin = new BlockPos(wanted.getBlockX(), wanted.getBlockY(), wanted.getBlockZ());
    var spot =
        SafeSpots.nearest(
            probe(world), origin, radius, pos -> reachable.test(standing(world, pos, wanted)));
    if (spot.isEmpty()) {
      return Result.err(CastProblem.refused(new Refusal.NoSafeSpot()));
    }
    var destination = standing(world, spot.get(), wanted);
    return guard
        .denial(caster, ProtectedAction.TELEPORT_INTO, destination)
        .<Result<Location, CastProblem>>map(reason -> Result.err(new CastProblem.Protected(reason)))
        .orElseGet(() -> Result.ok(destination));
  }

  private static Location standing(World world, BlockPos pos, Location facing) {
    var feet = pos.feet();
    return new Location(world, feet.x(), feet.y(), feet.z(), facing.getYaw(), facing.getPitch());
  }

  /**
   * True when nothing solid lies between {@code from} and the body of someone standing at {@code
   * feet}: a teleport never passes through a wall.
   */
  public static boolean clearPath(Location from, Location feet) {
    var body = feet.clone().add(0, BODY_HEIGHT, 0);
    var delta = body.toVector().subtract(from.toVector());
    var distance = delta.length();
    if (distance < MIN_TRACE) {
      return true;
    }
    return from.getWorld()
            .rayTraceBlocks(from, delta.normalize(), distance, FluidCollisionMode.NEVER, true)
        == null;
  }

  /** Moves {@code caster} to {@code destination}, clearing any fall they had built up. */
  public static void teleport(Player caster, Location destination) {
    caster.setFallDistance(0);
    caster.teleport(destination, PlayerTeleportEvent.TeleportCause.PLUGIN);
  }
}
