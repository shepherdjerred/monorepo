package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * When a Ninja or a Ghost throws an ender pearl, and where. A pearl puts its thrower where it lands
 * and costs it some health on arrival, so it is thrown for distance a run would take too long to
 * cover:
 *
 * <ul>
 *   <li><b>to close</b>: the enemy it fights is out of sword reach and running off, or carries a
 *       bow, or is a long run away, and the bot can afford the landing; it throws along its own
 *       path toward them, or short of them across open ground;
 *   <li><b>to escape</b>: hurt, with an enemy close, while it is breaking away; it throws along its
 *       own path away from them, if it can afford the landing.
 * </ul>
 *
 * <p>A pearl only goes onto a waypoint of the bot's own path, a cell the nav graph certified as
 * standing ground and reachable from where the bot is, or, chasing an enemy across open ground
 * (where a fight has no path), onto floor short of the enemy from which the ground runs whole to
 * its feet ({@link Footing#wholeGround}). The throw is followed through the map with its stray
 * before it leaves the hand, and is never made unless it comes down on the top of solid ground next
 * to that spot. Thrown standing on the ground only, as a player would.
 */
public final class PearlThrow {

  /** A pearl costs this much health on landing (feather falling softens it, never below this). */
  static final double LANDING_COST = 5;

  /** A bot keeps at least this much health after the landing, or it does not throw. */
  static final double SPARE = 2;

  /** A pearl that closes in lands at least this much nearer the enemy than the bot is. */
  static final double CLOSES_BY = 6;

  /** An escape lands at least this much further from the nearest enemy than the bot is. */
  static final double OPENS_BY = 6;

  /** An enemy this close is fought, not pearled to. */
  static final double SWORD_RANGE = 6;

  /** An enemy moving away faster than this, blocks a tick, is running off. */
  static final double FLEEING = 0.08;

  /** An enemy this close makes a hurt bot want out. */
  static final double TOO_CLOSE = 6;

  /** An enemy this far off is a run too long to make on foot. */
  static final double LONG_RUN = 14;

  /** How far short of an enemy, blocks, a pearl thrown straight at it may land. */
  static final double[] SHORT_OF_ENEMY = {3, 4.5, 6};

  /** How near the chosen spot the pearl must come down, blocks across the ground. */
  static final double ON_TARGET = 1.5;

  private PearlThrow() {}

  /** The throw, if this is its moment and there is a safe place for it. */
  public static Optional<BodyCommand.UseKit> choose(
      Loadout.KitItem item, ReflexInput input, int waypointIndex, KitPlay.Means means) {
    var self = input.self();
    if (means.grid().isEmpty()
        || !self.onGround()
        || self.usingItem()
        || self.effectiveHealth() < LANDING_COST + SPARE) {
      return Optional.empty();
    }
    var close = closing(input);
    var escape = escaping(input);
    if ((close.isEmpty() && escape.isEmpty()) || !means.timing().notices()) {
      return Optional.empty();
    }
    var grid = means.grid().orElseThrow();
    for (var spot : spots(input, waypointIndex, close, grid)) {
      var distance = spot.distance(self.pos());
      if (distance < item.move().min()
          || distance > item.move().max()
          || !worthIt(self, spot, close, escape)) {
        continue;
      }
      var at = throwAt(grid, self, spot, means.timing());
      if (at.isPresent()) {
        return Optional.of(new BodyCommand.UseKit(item.slot(), Optional.empty(), at));
      }
    }
    return Optional.empty();
  }

  /**
   * Whether landing on {@code spot} is worth a pearl: markedly nearer the enemy it closes on, or
   * further from the one it escapes.
   */
  private static boolean worthIt(
      CombatantView self,
      Vec3 spot,
      Optional<CombatantView> close,
      Optional<CombatantView> escape) {
    var closes =
        close
            .map(
                enemy -> spot.distance(enemy.pos()) <= self.pos().distance(enemy.pos()) - CLOSES_BY)
            .orElse(true);
    var opens =
        escape
            .map(enemy -> spot.distance(enemy.pos()) >= self.pos().distance(enemy.pos()) + OPENS_BY)
            .orElse(true);
    return closes && opens;
  }

  /**
   * Where a pearl may go, best first: the ground waypoints still ahead on the bot's path, farthest
   * first; then, closing on an enemy it runs straight at (a fight in the open has no path), ground
   * a few blocks short of the enemy on the line between them, where the floor runs whole to the
   * enemy's feet.
   */
  private static List<Vec3> spots(
      ReflexInput input, int waypointIndex, Optional<CombatantView> close, VoxelGrid grid) {
    var spots = new ArrayList<Vec3>();
    var waypoints = input.decision().waypoints();
    for (var i = waypoints.size() - 1; i >= Math.max(0, waypointIndex); i--) {
      if (waypoints.get(i).landing() == Waypoint.Landing.GROUND) {
        spots.add(waypoints.get(i).pos());
      }
    }
    var enemy = close.filter(CombatantView::onGround);
    if (enemy.isPresent()) {
      var feet = enemy.orElseThrow().pos();
      var back = input.self().pos().minus(feet).horizontal();
      if (!back.isZero()) {
        for (var gap : SHORT_OF_ENEMY) {
          var spot = feet.plus(back.normalized().scale(gap));
          var ground = new Vec3(Math.floor(spot.x()) + 0.5, feet.y(), Math.floor(spot.z()) + 0.5);
          if (Footing.wholeGround(grid, ground, feet)) {
            spots.add(ground);
          }
        }
      }
    }
    return spots;
  }

  /** The enemy fought out of sword reach and running off or shooting, if any. */
  static Optional<CombatantView> closing(ReflexInput input) {
    var self = input.self();
    if (input.decision().stance() == Stance.EVASIVE) {
      return Optional.empty();
    }
    return input
        .target()
        .filter(enemy -> enemy.pos().distance(self.pos()) > SWORD_RANGE)
        .filter(
            enemy ->
                enemy.kit().hasBow()
                    || fleeing(self, enemy)
                    || enemy.pos().distance(self.pos()) >= LONG_RUN);
  }

  /** The nearest enemy in sight a hurt bot breaking away wants out of reach of, if any. */
  static Optional<CombatantView> escaping(ReflexInput input) {
    var self = input.self();
    var breaking =
        input.decision().stance() == Stance.EVASIVE
            || switch (input.decision().option()) {
              case RETREAT, HEAL -> true;
              default -> false;
            };
    if (!breaking || self.effectiveHealth() >= KitPlay.LOW) {
      return Optional.empty();
    }
    return input.perceived().stream()
        .filter(enemy -> enemy.pos().distance(self.pos()) <= TOO_CLOSE)
        .findFirst();
  }

  private static boolean fleeing(CombatantView self, CombatantView enemy) {
    var away = enemy.pos().minus(self.pos()).horizontal();
    if (away.isZero()) {
      return false;
    }
    return enemy.vel().horizontal().dot(away.normalized()) > FLEEING;
  }

  /**
   * A point to look at that throws the pearl onto {@code spot}, after the hand's stray, if the
   * pearl then comes down safely beside it; the pearl is followed both as thrown and as carrying
   * the bot's own run.
   */
  private static Optional<Vec3> throwAt(
      VoxelGrid grid, CombatantView self, Vec3 spot, KitTiming timing) {
    var eye = self.eye();
    var aim = PearlFlight.aim(eye, spot);
    if (aim.isEmpty()) {
      return Optional.empty();
    }
    var thrown = timing.stray(aim.orElseThrow());
    var plain = PearlFlight.landing(grid, eye, thrown, Vec3.ZERO);
    var carried = PearlFlight.landing(grid, eye, thrown, self.vel().horizontal());
    var onTarget =
        plain
            .filter(land -> land.horizontalDistance(spot) <= ON_TARGET)
            .filter(land -> Math.abs(land.y() - spot.y()) <= 1)
            .isPresent();
    if (!onTarget || carried.isEmpty()) {
      return Optional.empty();
    }
    return Optional.of(eye.plus(thrown.direction().scale(8)));
  }
}
