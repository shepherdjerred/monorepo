package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static java.util.Comparator.comparingDouble;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * How a ranged bot uses height. It holds cover above the point it watches when that cover keeps a
 * shot within its band one step away, and, chased by a sword, it runs up a nearby ladder or ledge
 * the sword must climb after it, so it shoots down at a climber instead of being cut down on the
 * flat. Swords are unaffected.
 */
final class HighGround {

  /** A visible sword this close, horizontally, is chasing a ranged bot. */
  static final double CHASE_RANGE = 10;

  /** A refuge stands at least this many blocks above the chaser. */
  static final double RISE = 2;

  /** How far round the bot, horizontally, a refuge is looked for, in blocks. */
  static final int SEARCH = 8;

  /** The highest a refuge may stand above the bot, in blocks. */
  static final int MAX_RISE = 8;

  /** How many of the nearest refuges are routed to before the bot gives up on height. */
  static final int TRIES = 3;

  /** The longest route to a refuge, in waypoints. */
  static final int MAX_STEPS = 16;

  /** Where on an enemy a shot is aimed from cover, above its feet. */
  private static final double CHEST = 1.3;

  private HighGround() {}

  /**
   * What standing in the cover at {@code node} is worth to the bot, in blocks of travel, for its
   * height over {@code threat}: nothing for a sword, below the threat, outside the bot's band, or
   * where neither the cover nor a step beside it has a line to the threat.
   */
  static double advantage(TacticsContext context, int node, Vec3 threat) {
    var keep = context.keep();
    if (!keep.ranged()) return 0;
    var nav = context.nav();
    var feet = nav.graph().feet(node);
    var elevation = feet.y() - threat.y();
    var range = feet.horizontalDistance(threat);
    if (elevation <= 0 || range < keep.min() || range > keep.max()) return 0;
    return overlooks(nav, node, threat) ? RangedPosition.heightAdvantage(elevation) : 0;
  }

  private static boolean overlooks(NavArtifact nav, int node, Vec3 threat) {
    var target = threat.plus(0, CHEST, 0);
    return sees(nav, node, target)
        || nav.graph().neighbors(node).stream().anyMatch(next -> sees(nav, next, target));
  }

  private static boolean sees(NavArtifact nav, int node, Vec3 target) {
    return nav.grid().canSee(nav.graph().feet(node).plus(0, CombatantView.EYE_HEIGHT, 0), target);
  }

  /** The nearest visible sword within {@link #CHASE_RANGE}, if one is chasing the bot. */
  static Optional<Situation.KnownEnemy> meleeChaser(Situation situation) {
    var self = situation.self().pos();
    return situation.knownEnemies().stream()
        .filter(Situation.KnownEnemy::visible)
        .filter(enemy -> enemy.pos().horizontalDistance(self) <= CHASE_RANGE)
        .filter(
            enemy ->
                situation
                    .snapshot()
                    .combatant(enemy.id())
                    .map(view -> !view.kit().hasBow())
                    .orElse(false))
        .findFirst();
  }

  /**
   * Whether a ranged bot already stands {@link #RISE} above the sword chasing it, where the sword
   * must climb to reach it: it stays and shoots rather than backing off the top.
   */
  static boolean holds(Situation situation, TacticsContext context) {
    if (!context.keep().ranged()) return false;
    var self = situation.self().pos();
    var node = context.nav().graph().nearestNode(self);
    return node.isPresent()
        && meleeChaser(situation)
            .filter(chaser -> self.y() - chaser.pos().y() >= RISE)
            .filter(chaser -> chaserClimbs(context, chaser.pos(), node.getAsInt()))
            .isPresent();
  }

  /**
   * Where a ranged bot chased by a sword runs to: the nearest standing spot within {@link #SEARCH}
   * blocks and {@link #RISE} blocks above the sword, whose route climbs a ladder or jumps up a
   * ledge starting no nearer the sword than the bot, and which the sword's own route can only reach
   * by climbing too. Empty for a sword, when nothing chases the bot, when it is already above its
   * chaser, or when no such spot is near.
   */
  static Optional<Planner.CoverSpot> refuge(Situation situation, TacticsContext context) {
    if (!context.keep().ranged()) return Optional.empty();
    var self = situation.self().pos();
    var chaser =
        meleeChaser(situation)
            .map(Situation.KnownEnemy::pos)
            .filter(pos -> self.y() - pos.y() < RISE);
    if (chaser.isEmpty()) return Optional.empty();
    var from = chaser.orElseThrow();
    var graph = context.nav().graph();
    return candidates(context, self, from).stream()
        .filter(node -> Planner.coverAvailable(situation, context, node))
        .filter(node -> RecoverySteps.usable(situation, context, node))
        .limit(TRIES)
        .filter(node -> climbsTo(situation, context, from, node))
        .filter(node -> chaserClimbs(context, from, node))
        .findFirst()
        .map(node -> new Planner.CoverSpot(node, graph.feet(node)));
  }

  /** Standing spots near {@code self} high enough above {@code chaser}, nearest first. */
  private static List<Integer> candidates(TacticsContext context, Vec3 self, Vec3 chaser) {
    var graph = context.nav().graph();
    var base = BlockPos.of(self);
    var lowest = Math.max(base.y() + 1, (int) Math.floor(chaser.y() + RISE));
    var out = new ArrayList<Integer>();
    for (var y = lowest; y <= base.y() + MAX_RISE; y++) {
      for (var z = base.z() - SEARCH; z <= base.z() + SEARCH; z++) {
        for (var x = base.x() - SEARCH; x <= base.x() + SEARCH; x++) {
          graph
              .nodeAt(new BlockPos(x, y, z))
              .ifPresent(
                  node -> {
                    if (!graph.climbable(node) && graph.feet(node).y() - chaser.y() >= RISE)
                      out.add(node);
                  });
        }
      }
    }
    out.sort(comparingDouble(node -> graph.feet(node).distance(self)));
    return out;
  }

  /** Whether the bot's own escape route to {@code node} climbs, starting away from the chaser. */
  private static boolean climbsTo(
      Situation situation, TacticsContext context, Vec3 chaser, int node) {
    var self = situation.self().pos();
    var points =
        Planner.pathTo(
                situation,
                context,
                context.nav().graph().feet(node),
                new Planner.Way(Stance.EVASIVE, false))
            .waypoints();
    if (points.isEmpty() || points.size() > MAX_STEPS) return false;
    var start = self.horizontalDistance(chaser);
    return firstClimb(points, self)
        .filter(foot -> foot.horizontalDistance(chaser) >= start - 1)
        .isPresent();
  }

  /** Whether the chaser cannot reach {@code node} without climbing as well. */
  private static boolean chaserClimbs(TacticsContext context, Vec3 chaser, int node) {
    var from = context.nav().graph().nearestNode(chaser);
    if (from.isEmpty()) return true;
    return context
        .path(from.getAsInt(), node, any -> 0)
        .map(path -> firstClimb(path.toFollow(), chaser).isPresent())
        .orElse(true);
  }

  /** Where the first climb or upward jump of {@code points}, walked from {@code from}, starts. */
  private static Optional<Vec3> firstClimb(List<Waypoint> points, Vec3 from) {
    var previous = from;
    for (var point : points) {
      var rise = point.pos().y() - previous.y();
      if ((point.hop() == Hop.CLIMB && rise > 0) || (point.hop() == Hop.JUMP && rise > 0.5))
        return Optional.of(previous);
      previous = point.pos();
    }
    return Optional.empty();
  }
}
