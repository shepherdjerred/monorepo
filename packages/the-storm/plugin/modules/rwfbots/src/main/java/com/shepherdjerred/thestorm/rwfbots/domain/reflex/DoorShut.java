package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static java.util.Comparator.comparingDouble;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import java.util.List;
import java.util.Optional;

/**
 * A bot breaking contact pulls a wooden door shut behind itself once it is through, so a chaser has
 * to stop and open it and loses sight of it meanwhile. It never shuts a door a teammate may still
 * be coming through, one its own route goes back through, or one it still stands in. Doors are
 * found and toggled by the body adapter; this only chooses.
 */
public final class DoorShut {

  /** The furthest from the bot's eye a door's middle may be for it to reach the handle. */
  public static final double REACH = Reflex.REACH;

  /**
   * The bot is clear of the doorway once its feet are this far from the door cell's centre along
   * either axis: half a cell plus the body's half width, and a little more.
   */
  static final double CLEAR = 0.85;

  /** An enemy within this distance of the door, on its far side, is following the bot through. */
  public static final double PURSUIT = 16;

  /** A teammate this close to the door who is not yet through it may be following the bot. */
  public static final double FOLLOWING = 8;

  /** An upcoming waypoint this close to the door means the bot's own route uses it. */
  static final double OWN_PATH = 1.5;

  /** How many upcoming waypoints are checked for the bot's own route through the door. */
  static final int LOOKAHEAD = 4;

  private DoorShut() {}

  /**
   * What the choice is made from.
   *
   * @param self the bot
   * @param decision what it is doing, with its route
   * @param waypointIndex the waypoint it is walking to
   * @param pursuers the enemies it sees
   * @param allies its living teammates, itself excluded
   */
  public record Escape(
      CombatantView self,
      Decision decision,
      int waypointIndex,
      List<CombatantView> pursuers,
      List<CombatantView> allies) {

    public Escape {
      pursuers = List.copyOf(pursuers);
      allies = List.copyOf(allies);
    }
  }

  /** Whether {@code decision} is breaking contact: fleeing, falling back to heal, backing off. */
  public static boolean escaping(Decision decision) {
    return decision.stance() == Stance.EVASIVE
        || decision.option() == Option.RETREAT
        || decision.option() == Option.HEAL;
  }

  /**
   * The open door, by its lower half, the bot pulls shut now, if any; the nearest when several
   * qualify.
   */
  public static Optional<BlockPos> behind(Escape escape, List<BlockPos> openDoors) {
    if (!escaping(escape.decision())) return Optional.empty();
    var self = escape.self().pos();
    return openDoors.stream()
        .filter(door -> shuts(escape, door))
        .min(comparingDouble(door -> door.feet().distance(self)));
  }

  private static boolean shuts(Escape escape, BlockPos door) {
    var centre = door.feet();
    var self = escape.self();
    return through(self.pos(), centre)
        && self.eye().distance(centre.plus(0, 1, 0)) <= REACH
        && !ownRoute(escape, centre)
        && escape.pursuers().stream().anyMatch(enemy -> following(self.pos(), centre, enemy))
        && escape.pursuers().stream().noneMatch(enemy -> inDoorway(enemy.pos(), centre))
        && escape.allies().stream().noneMatch(ally -> mayFollow(self.pos(), centre, ally));
  }

  /** Whether a body at {@code feet} stands on the door's floor but outside its cell. */
  private static boolean through(Vec3 feet, Vec3 centre) {
    return sameFloor(feet, centre) && apart(feet, centre) >= CLEAR;
  }

  /** Whether a body at {@code feet} stands in the doorway, where a shut door would meet it. */
  private static boolean inDoorway(Vec3 feet, Vec3 centre) {
    return sameFloor(feet, centre) && apart(feet, centre) < CLEAR;
  }

  private static boolean sameFloor(Vec3 feet, Vec3 centre) {
    return feet.y() > centre.y() - 0.5 && feet.y() < centre.y() + 1;
  }

  private static double apart(Vec3 feet, Vec3 centre) {
    return Math.max(Math.abs(feet.x() - centre.x()), Math.abs(feet.z() - centre.z()));
  }

  /** Which side of the door {@code point} is on: positive on the bot's side, negative beyond. */
  private static double side(Vec3 self, Vec3 centre, Vec3 point) {
    return point.minus(centre).horizontal().dot(self.minus(centre).horizontal());
  }

  /** Whether the next few waypoints go through the door or back to its far side. */
  private static boolean ownRoute(Escape escape, Vec3 centre) {
    var waypoints = escape.decision().waypoints();
    var self = escape.self().pos();
    var end = Math.min(waypoints.size(), escape.waypointIndex() + LOOKAHEAD);
    for (var index = escape.waypointIndex(); index < end; index++) {
      var point = waypoints.get(index).pos();
      if (point.horizontalDistance(centre) <= OWN_PATH || side(self, centre, point) < 0)
        return true;
    }
    return false;
  }

  private static boolean following(Vec3 self, Vec3 centre, CombatantView enemy) {
    return enemy.alive()
        && enemy.pos().horizontalDistance(centre) <= PURSUIT
        && side(self, centre, enemy.pos()) < 0;
  }

  private static boolean mayFollow(Vec3 self, Vec3 centre, CombatantView ally) {
    return ally.alive()
        && ally.pos().horizontalDistance(centre) <= FOLLOWING
        && (side(self, centre, ally.pos()) <= 0 || inDoorway(ally.pos(), centre));
  }
}
