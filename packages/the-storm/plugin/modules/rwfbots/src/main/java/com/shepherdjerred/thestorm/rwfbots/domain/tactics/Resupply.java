package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Quiver;
import java.util.Comparator;
import java.util.Optional;

/**
 * When a bot whose shots spend arrows goes to pick up arrows lying near it. With fewer than {@link
 * #RESUPPLY_BELOW} arrows, no enemy in sight within {@link #SAFE_RANGE} or known within {@link
 * #CLEAR_RANGE}, and no fuse, bomb or plant slot of its own to see to, it walks onto the cell of
 * the nearest loose arrow within {@link #SEARCH} blocks; the server's touch rule picks the arrow up
 * when the bot stands there. The emptier the quiver and the nearer the arrow, the more the trip is
 * worth: an empty quiver beside an arrow outweighs holding a slot, a nearly full one rarely does.
 */
public final class Resupply {

  /** A finite quiver with fewer arrows than this fetches loose ones when it is safe. */
  public static final int RESUPPLY_BELOW = 24;

  /** Only arrows this close to the bot are worth the walk, in blocks. */
  static final double SEARCH = 12;

  /** No enemy may be in sight this close. */
  static final double SAFE_RANGE = 20;

  /** No enemy may be known, at least half sure, this close. */
  static final double CLEAR_RANGE = 10;

  /** An arrow lies on the walkable cell whose feet are horizontally this close. */
  static final double CELL_REACH = 1.2;

  /** How far below and above a cell's feet an arrow may lie and still be touched there. */
  static final double CELL_BELOW = 0.8;

  static final double CELL_ABOVE = 1.6;

  /** An arrow this close to the bot, horizontally, would have been picked up: it cannot be. */
  static final double IN_REACH = 0.8;

  /** An arrow is gone once nothing lies this close to where it lay. */
  static final double LIFTED = 0.25;

  /** What fetching an arrow is worth with a full need, before its distance discounts it. */
  static final double BASE = 0.5;

  static final double NEED = 0.4;

  /** How much of the worth an arrow at the edge of the search loses to the walk. */
  static final double WALK_DISCOUNT = 0.3;

  private Resupply() {}

  /**
   * A loose arrow and the walkable cell to stand on to pick it up.
   *
   * @param arrow where the arrow lies
   * @param cell the feet of the cell to stand on
   */
  public record Pickup(Vec3 arrow, Vec3 cell) {}

  /**
   * An arrow worth fetching now.
   *
   * @param pickup the arrow and its cell
   * @param worth the RESUPPLY utility
   */
  public record Trip(Pickup pickup, double worth) {}

  /** The trip the bot would make now, if its quiver is low, it is safe and an arrow lies near. */
  public static Optional<Trip> trip(
      Situation situation, Features features, TacticsContext context, TacticalMemory memory) {
    var quiver = situation.self().quiver();
    if (!low(quiver) || busy(features) || !clear(situation)) {
      return Optional.empty();
    }
    var need = 1 - (double) quiver.arrows() / RESUPPLY_BELOW;
    return nearest(situation, context, memory)
        .map(
            pickup -> {
              var walk = Math.min(1, pickup.cell().distance(situation.self().pos()) / SEARCH);
              return new Trip(pickup, (BASE + NEED * need) * (1 - WALK_DISCOUNT * walk));
            });
  }

  /** Whether {@code quiver} spends arrows and is short enough to fetch more. */
  public static boolean low(Quiver quiver) {
    return quiver.finite() && quiver.arrows() < RESUPPLY_BELOW;
  }

  /** Whether the bot has a fuse, its bomb, its plant slot or poison to see to first. */
  private static boolean busy(Features features) {
    return features.ownBombLit()
        || features.allyArming()
        || features.plantSlot()
        || features.enemyNearOwnBomb()
        || features.enemyApproachingOwnBomb()
        || features.inOwnBombPoisonZone();
  }

  /** Whether no enemy is in sight nearby or known, fairly surely, close by. */
  static boolean clear(Situation situation) {
    var self = situation.self().pos();
    return situation.knownEnemies().stream()
        .noneMatch(
            enemy ->
                enemy.visible()
                    ? enemy.pos().distance(self) <= SAFE_RANGE
                    : enemy.confidence() >= 0.5 && enemy.pos().distance(self) <= CLEAR_RANGE);
  }

  /**
   * The nearest loose arrow within {@link #SEARCH} that lies on a walkable cell the bot has not
   * just failed to route to, and is not already at its feet.
   */
  static Optional<Pickup> nearest(
      Situation situation, TacticsContext context, TacticalMemory memory) {
    var self = situation.self().pos();
    var graph = context.nav().graph();
    return situation.snapshot().looseArrows().stream()
        .filter(arrow -> arrow.distance(self) <= SEARCH)
        .filter(arrow -> !(arrow.horizontalDistance(self) <= IN_REACH && near(arrow.y(), self.y())))
        .sorted(Comparator.comparingDouble(arrow -> arrow.distance(self)))
        .map(arrow -> pickup(arrow, graph))
        .flatMap(Optional::stream)
        .filter(pickup -> !memory.excludes(pickup.cell(), situation.now()))
        .findFirst();
  }

  /** {@code arrow} and the walkable cell it can be touched from, if it lies on one. */
  private static Optional<Pickup> pickup(Vec3 arrow, NavGraph graph) {
    var node = graph.nearestNodeWithin(arrow, 1);
    if (node.isEmpty()) {
      return Optional.empty();
    }
    var feet = graph.feet(node.getAsInt());
    return touchable(arrow, feet) ? Optional.of(new Pickup(arrow, feet)) : Optional.empty();
  }

  private static boolean touchable(Vec3 arrow, Vec3 feet) {
    return arrow.horizontalDistance(feet) <= CELL_REACH && near(arrow.y(), feet.y());
  }

  private static boolean near(double arrowY, double feetY) {
    var rise = arrowY - feetY;
    return rise >= -CELL_BELOW && rise <= CELL_ABOVE;
  }

  /** Whether an arrow still lies at {@code arrow}. */
  static boolean lying(Situation situation, Vec3 arrow) {
    return situation.snapshot().looseArrows().stream()
        .anyMatch(loose -> loose.distance(arrow) <= LIFTED);
  }

  /** The plan that walks onto {@code pickup}'s cell. */
  static Plan plan(long now, Pickup pickup) {
    return Plan.of(Option.RESUPPLY, now, new PlanStep.Pickup(pickup.arrow(), pickup.cell()));
  }
}
