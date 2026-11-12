package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BombView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CrateView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import java.util.ArrayDeque;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;

/**
 * When a bot calls in a supply crate it carries, and when it walks over to loot one. A carried
 * crate is called from a cell with no known enemy nearby and not on a bomb column. A landed crate
 * is a short detour, like picking up arrows: reachable, nobody on it, and never instead of a fuse.
 * The owner's own crate comes before a steal, and one living teammate claims each crate.
 */
public final class CratePlay {

  /** A known enemy this close, in blocks, makes a cell a bad place to call a crate in. */
  public static final double NEARBY = 12;

  /** An enemy this close to a landed crate, in blocks, means leave it for now. */
  public static final double ON_CRATE = 8;

  /** How far, in blocks, a bot will walk to call or loot. */
  public static final double SEARCH = 16;

  /** A bomb column is this wide, horizontally, and a crate is not called on one. */
  public static final double BOMB_COLUMN = 1.5;

  /** Close enough to right-click the chest, in blocks. */
  public static final double REACH = 3.5;

  /** How long to wait for a called crate to land and be looted, in ticks (15 s). */
  public static final int WATCH_TICKS = 300;

  /**
   * How many nav nodes a safe-cell search may visit. An open floor within {@link #SEARCH} is a few
   * hundred nodes, and the safe cells sit past every closer one.
   */
  static final int NODE_CAP = 1024;

  static final double CALL_WORTH = 0.62;

  static final double OWN_WORTH = 0.6;

  static final double STEAL_WORTH = 0.48;

  static final double WALK_DISCOUNT = 0.3;

  private CratePlay() {}

  /** Whether the trip calls a carried crate in or loots one that has landed. */
  public enum Kind {
    CALL,
    LOOT
  }

  /**
   * What to do while waiting on a crate this bot just called in.
   *
   * <p>{@link #FIGHT} leaves the body to the reflex. {@link #CLEAR} drops the watch.
   */
  public enum Attention {
    CLEAR,
    FIGHT,
    LOOT,
    APPROACH,
    HOLD
  }

  /**
   * A crate trip.
   *
   * @param cell where to stand
   * @param worth the CRATE utility
   * @param kind call a carried crate, or loot a landed one
   */
  public record Trip(Vec3 cell, double worth, Kind kind) {}

  /** The trip now, if a fuse is not more important and a crate is worth the walk. */
  public static Optional<Trip> trip(
      Situation situation, Features features, TacticsContext context, TacticalMemory memory) {
    if (busy(features)) {
      return Optional.empty();
    }
    var call = call(situation, context, memory);
    if (call.isPresent()) {
      return call;
    }
    return loot(situation, context, memory);
  }

  /** The plan that walks to {@code trip}'s cell. A route, not a pickup: a pickup ends at once. */
  static Plan plan(long now, Trip trip) {
    return Plan.of(Option.CRATE, now, new PlanStep.Route(trip.cell(), Stance.CAUTIOUS));
  }

  /**
   * Whether this is a safe moment to call a supply crate in where the bot stands: no perceived
   * enemy within {@link #NEARBY}, and not on a bomb column.
   */
  public static boolean safeToCall(
      CombatantView self,
      List<CombatantView> perceived,
      Optional<CombatantView> target,
      List<BombView> bombs) {
    var pos = self.pos();
    if (perceived.stream().anyMatch(enemy -> enemy.pos().distance(pos) <= NEARBY)) {
      return false;
    }
    if (target.filter(enemy -> enemy.pos().distance(pos) <= NEARBY).isPresent()) {
      return false;
    }
    return bombs.stream().noneMatch(bomb -> bomb.pos().horizontalDistance(pos) <= BOMB_COLUMN);
  }

  /** Whether a diamond chestplate in the inventory should be worn. */
  public static boolean wearChestplate(boolean wearingDiamond, boolean carryingDiamond) {
    return !wearingDiamond && carryingDiamond;
  }

  /**
   * What a bot waiting on its own crate does. {@code seen} is whether the crate has appeared.
   * {@code present} is whether that crate is still in the world. A fight keeps the watch.
   */
  public static Attention attention(
      long now, long until, boolean threatened, boolean seen, boolean present, boolean inReach) {
    if (now > until || (seen && !present)) {
      return Attention.CLEAR;
    }
    if (threatened) {
      return Attention.FIGHT;
    }
    if (present && inReach) {
      return Attention.LOOT;
    }
    if (present) {
      return Attention.APPROACH;
    }
    return Attention.HOLD;
  }

  private static Optional<Trip> call(
      Situation situation, TacticsContext context, TacticalMemory memory) {
    if (!situation.snapshot().supplyCarriers().contains(situation.self().id())) {
      return Optional.empty();
    }
    var self = situation.self().pos();
    if (safe(situation, self)) {
      return Optional.empty();
    }
    return safeCell(situation, context.nav().graph())
        .filter(cell -> !memory.excludes(cell, situation.now()))
        .map(cell -> new Trip(cell, worth(CALL_WORTH, cell.distance(self)), Kind.CALL));
  }

  private static Optional<Trip> loot(
      Situation situation, TacticsContext context, TacticalMemory memory) {
    var self = situation.self();
    var graph = context.nav().graph();
    var crates =
        situation.snapshot().crates().stream()
            .filter(crate -> canLoot(situation, self, crate))
            .toList();
    var own = crates.stream().filter(crate -> crate.owner().equals(self.id())).toList();
    var pool = own.isEmpty() ? crates : own;
    return pool.stream()
        .filter(crate ->
            claimant(situation, crate).map(mate -> mate.id().equals(self.id())).orElse(false))
        .filter(crate -> !contested(situation, crate.pos()))
        .map(crate -> cell(situation, graph, memory, crate))
        .flatMap(Optional::stream)
        .min(Comparator.comparingDouble(trip -> trip.cell().distance(self.pos())));
  }

  private static Optional<Trip> cell(
      Situation situation, NavGraph graph, TacticalMemory memory, CrateView crate) {
    var node = graph.nearestNodeWithin(crate.pos(), 2);
    if (node.isEmpty()) {
      return Optional.empty();
    }
    var feet = graph.feet(node.getAsInt());
    var self = situation.self().pos();
    if (feet.distance(self) > SEARCH || memory.excludes(feet, situation.now())) {
      return Optional.empty();
    }
    var base = crate.team().equals(situation.self().team()) ? OWN_WORTH : STEAL_WORTH;
    return Optional.of(new Trip(feet, worth(base, feet.distance(self)), Kind.LOOT));
  }

  private static Optional<CombatantView> claimant(Situation situation, CrateView crate) {
    return situation.snapshot().alive(situation.self().team()).stream()
        .filter(mate -> canLoot(situation, mate, crate))
        .filter(mate -> mate.pos().distance(crate.pos()) <= SEARCH)
        .min(
            Comparator.comparingDouble((CombatantView mate) -> mate.pos().distance(crate.pos()))
                .thenComparing(CombatantView::id));
  }

  private static boolean canLoot(Situation situation, CombatantView mate, CrateView crate) {
    return crate.mayLoot(mate.id(), mate.team(), situation.now());
  }

  private static boolean contested(Situation situation, Vec3 pos) {
    return situation.knownEnemies().stream()
        .anyMatch(enemy ->
            (enemy.visible() || enemy.confidence() >= 0.5)
                && enemy.pos().distance(pos) <= ON_CRATE);
  }

  private static boolean busy(Features features) {
    return features.ownBombLit()
        || features.allyArming()
        || features.plantSlot()
        || features.enemyNearOwnBomb()
        || features.enemyApproachingOwnBomb()
        || features.inOwnBombPoisonZone();
  }

  private static boolean safe(Situation situation, Vec3 feet) {
    if (onBomb(situation, feet)) {
      return false;
    }
    return situation.knownEnemies().stream()
        .noneMatch(enemy ->
            (enemy.visible() || enemy.confidence() >= 0.5) && enemy.pos().distance(feet) <= NEARBY);
  }

  private static boolean onBomb(Situation situation, Vec3 feet) {
    return situation.snapshot().bombs().stream()
        .anyMatch(bomb -> bomb.pos().horizontalDistance(feet) <= BOMB_COLUMN);
  }

  private static Optional<Vec3> safeCell(Situation situation, NavGraph graph) {
    var self = situation.self().pos();
    var start = graph.nearestNodeWithin(self, 2);
    if (start.isEmpty()) {
      return Optional.empty();
    }
    var seen = new HashSet<Integer>();
    var queue = new ArrayDeque<Integer>();
    queue.add(start.getAsInt());
    seen.add(start.getAsInt());
    var best = Optional.<Vec3>empty();
    var bestDistance = Double.POSITIVE_INFINITY;
    var visited = 0;
    while (!queue.isEmpty() && visited < NODE_CAP) {
      var node = queue.removeFirst();
      visited++;
      var feet = graph.feet(node);
      var distance = feet.distance(self);
      if (distance <= SEARCH && distance < bestDistance && safe(situation, feet)) {
        best = Optional.of(feet);
        bestDistance = distance;
      }
      if (distance > SEARCH) {
        continue;
      }
      for (var next : graph.neighbors(node)) {
        if (seen.add(next)) {
          queue.add(next);
        }
      }
    }
    return best;
  }

  private static double worth(double base, double distance) {
    var walk = Math.min(1, distance / SEARCH);
    return base * (1 - WALK_DISCOUNT * walk);
  }
}
