package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.KitMove;
import java.util.Optional;

/**
 * When a Windrunner or a Maceguard throws a wind charge, and at what. A wind charge flies straight
 * and bursts on the first thing it touches, flinging everyone within a couple of blocks away from
 * the burst, its thrower too: thrown at an enemy it shoves them off, thrown at the ground by its
 * own feet it launches the thrower up and away from that spot, and a launch spares the fall back to
 * the height it left from. So a bot:
 *
 * <ul>
 *   <li><b>escapes</b>: hurt with an enemy close, it bursts the charge at its feet on the enemy's
 *       side and flies off the other way;
 *   <li><b>knocks an enemy off a ledge</b>: an enemy close by stands with a long drop or the void
 *       just behind it;
 *   <li><b>makes room</b> (a bow kit): an enemy has closed to sword reach, so the bot shoves it
 *       back out to bow range;
 *   <li><b>smashes</b> (a mace kit): with an enemy at hand it launches straight up to come down on
 *       them, a mace's smash growing with the fall;
 *   <li><b>leaps in</b> (a mace kit): an enemy stands a run away on open ground, so it bursts the
 *       charge just behind its feet and flies at them;
 *   <li><b>climbs</b>: with no fight on, the next waypoint is above a jump.
 * </ul>
 *
 * <p>The bot's own flight is only taken over ground it checks first: every column it crosses holds
 * a floor no more than {@link #DROP} below where it stands and has room for a body above, inside
 * the map, so a charge never throws a bot into the void or a pit, nor into a wall.
 */
public final class WindCharge {

  /** The deepest a bot's landing may be below where it stands, blocks. */
  static final int DROP = 3;

  /** The headroom a launched body needs above its feet along its flight, blocks. */
  static final int HEADROOM = 4;

  /** How far a launch away from a spot carries, blocks; its landing is checked this far. */
  static final int FLIGHT = 7;

  /** A drop this deep behind an enemy, or the void, is worth knocking it over. */
  static final int LEDGE_DROP = 5;

  /** How far behind an enemy a ledge must be to knock it over, blocks. */
  static final int LEDGE_BEHIND = 3;

  /** An enemy this close, blocks, is in sword reach. */
  static final double CONTACT = 3.5;

  /** How far beside the feet, toward or away from the enemy, the launching burst goes. */
  static final double BURST_OFFSET = 0.6;

  /** How high on an enemy a shove is aimed. */
  static final double BODY = 0.9;

  private WindCharge() {}

  /** The throw, if this is its moment and the bot's own flight is safe. */
  public static Optional<BodyCommand.UseKit> choose(
      Loadout.KitItem item, ReflexInput input, int waypointIndex, KitPlay.Means means) {
    var self = input.self();
    if (means.grid().isEmpty() || !self.onGround() || self.usingItem()) {
      return Optional.empty();
    }
    var grid = means.grid().orElseThrow();
    var at =
        input.target().isEmpty()
            ? climb(input, waypointIndex, grid)
            : input.target().flatMap(enemy -> against(item.move(), self, enemy, grid));
    if (at.isEmpty() || !means.timing().notices()) {
      return Optional.empty();
    }
    return Optional.of(new BodyCommand.UseKit(item.slot(), Optional.empty(), at));
  }

  /** Where to burst the charge in a fight with {@code enemy}, if anywhere. */
  private static Optional<Vec3> against(
      KitMove move, CombatantView self, CombatantView enemy, VoxelGrid grid) {
    var distance = self.pos().horizontalDistance(enemy.pos());
    var flat = enemy.pos().minus(self.pos()).horizontal();
    if (flat.isZero()) {
      return Optional.empty();
    }
    var toward = flat.normalized();
    var back = toward.scale(-1);
    if (self.effectiveHealth() < KitPlay.LOW) {
      return distance <= move.min() && flightClear(grid, self.pos(), back)
          ? Optional.of(burst(self, toward))
          : Optional.empty();
    }
    var close = distance <= move.min() && enemy.onGround();
    if (close && ledgeBehind(grid, enemy.pos(), toward) && standsFirm(grid, self.pos(), back)) {
      return Optional.of(enemy.pos().plus(0, BODY, 0));
    }
    if (self.kit().hasBow()) {
      return distance <= CONTACT && standsFirm(grid, self.pos(), back)
          ? Optional.of(enemy.pos().plus(0, BODY, 0))
          : Optional.empty();
    }
    return mace(move, self, enemy, grid);
  }

  /** A mace kit's launches: straight up over an enemy at hand, or a leap at one a run away. */
  private static Optional<Vec3> mace(
      KitMove move, CombatantView self, CombatantView enemy, VoxelGrid grid) {
    var distance = self.pos().horizontalDistance(enemy.pos());
    if (distance <= CONTACT) {
      return launchPad(grid, self.pos())
          ? Optional.of(self.pos().plus(0, -0.1, 0))
          : Optional.empty();
    }
    var toward = enemy.pos().minus(self.pos()).horizontal().normalized();
    var leap =
        distance > move.min()
            && distance <= move.max()
            && enemy.onGround()
            && Math.abs(enemy.pos().y() - self.pos().y()) <= 2
            && flightClear(grid, self.pos(), toward, (int) Math.ceil(distance) + 1);
    return leap ? Optional.of(burst(self, toward.scale(-1))) : Optional.empty();
  }

  /** The point on the ground by the feet, {@link #BURST_OFFSET} toward {@code side}. */
  private static Vec3 burst(CombatantView self, Vec3 side) {
    return self.pos().plus(side.scale(BURST_OFFSET)).plus(0, -0.1, 0);
  }

  /** A climb: the next waypoint is above a jump, and the ground around the feet bears a launch. */
  private static Optional<Vec3> climb(ReflexInput input, int index, VoxelGrid grid) {
    var self = input.self();
    var waypoints = input.decision().waypoints();
    var above = index < waypoints.size() && waypoints.get(index).pos().y() > self.pos().y() + 1;
    return above && launchPad(grid, self.pos())
        ? Optional.of(self.pos().plus(0, -0.1, 0))
        : Optional.empty();
  }

  /**
   * Whether a straight-up launch from {@code feet} comes down safely: the 3 by 3 floor around it is
   * whole and there is {@link #HEADROOM} above each of its columns.
   */
  public static boolean launchPad(VoxelGrid grid, Vec3 feet) {
    var base = BlockPos.of(feet);
    for (var dx = -1; dx <= 1; dx++) {
      for (var dz = -1; dz <= 1; dz++) {
        var cell = base.offset(dx, 0, dz);
        if (!Footing.floorAt(grid, cell) || !Footing.open(grid, cell, HEADROOM)) {
          return false;
        }
      }
    }
    return true;
  }

  /** Whether a launch from {@code feet} along {@code direction} flies and lands safely. */
  static boolean flightClear(VoxelGrid grid, Vec3 feet, Vec3 direction) {
    return flightClear(grid, feet, direction, FLIGHT);
  }

  private static boolean flightClear(VoxelGrid grid, Vec3 feet, Vec3 direction, int blocks) {
    var base = BlockPos.of(feet);
    if (!Footing.open(grid, base, HEADROOM)) {
      return false;
    }
    for (var step = 1; step <= blocks; step++) {
      var over = BlockPos.of(feet.plus(direction.scale(step)));
      var column = new BlockPos(over.x(), base.y(), over.z());
      if (!Footing.open(grid, column, HEADROOM) || Footing.landing(grid, column, DROP).isEmpty()) {
        return false;
      }
    }
    return true;
  }

  /** Whether the bot can take a shove's backwash: the ground behind it holds for two blocks. */
  static boolean standsFirm(VoxelGrid grid, Vec3 feet, Vec3 back) {
    var base = BlockPos.of(feet);
    for (var step = 1; step <= 2; step++) {
      var over = BlockPos.of(feet.plus(back.scale(step)));
      var column = new BlockPos(over.x(), base.y(), over.z());
      if (grid.blocksMovement(column)) {
        continue;
      }
      if (Footing.landing(grid, column, DROP).isEmpty()) {
        return false;
      }
    }
    return true;
  }

  /** Whether a long drop or the void lies within {@link #LEDGE_BEHIND} behind {@code feet}. */
  static boolean ledgeBehind(VoxelGrid grid, Vec3 feet, Vec3 away) {
    var base = BlockPos.of(feet);
    for (var step = 1; step <= LEDGE_BEHIND; step++) {
      var over = BlockPos.of(feet.plus(away.scale(step)));
      var column = new BlockPos(over.x(), base.y(), over.z());
      if (grid.blocksMovement(column) || grid.blocksMovement(column.up())) {
        return false;
      }
      if (deepFall(grid, column)) {
        return true;
      }
    }
    return false;
  }

  /** Whether nothing stops a fall from {@code column} for {@link #LEDGE_DROP} blocks. */
  private static boolean deepFall(VoxelGrid grid, BlockPos column) {
    for (var down = 1; down <= LEDGE_DROP; down++) {
      var cell = column.offset(0, -down, 0);
      if (!grid.bounds().contains(cell)) {
        return true;
      }
      if (grid.blocksMovement(cell)) {
        return false;
      }
    }
    return true;
  }
}
