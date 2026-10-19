package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavGraph;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * Holding is a patrol, not a statue: while a bot holds a slot, an angle or a retake point with no
 * enemy in sight, it moves between a few reachable posts around the spot, lingering at each for a
 * few seconds (longer the more patient it is), as a player holding an angle shifts and peeks. It
 * stands still to shoot a visible enemy and when sneaking as the last of its team.
 */
final class Patrol {

  /** How far a slot holder strays: inside {@link Features#SLOT_RADIUS}, so it still holds it. */
  static final double SLOT_RADIUS = 1.8;

  /** How far a bot holding an angle or a retake point strays. */
  static final double FREE_RADIUS = 3;

  /** The shortest stay at a post, for the least patient bot, in ticks (2 s). */
  static final long MIN_DWELL = 40;

  /** The longest stay at a post, for the most patient bot, in ticks (5 s). */
  static final long MAX_DWELL = 100;

  private Patrol() {}

  /**
   * The post the bot holding {@code hold} should stand at now, or empty when it should stand still:
   * an enemy is in sight, it is the last of its team, or no other reachable post is in range.
   */
  static Optional<Vec3> post(
      Situation situation, TacticsContext context, Vec3 hold, double radius) {
    if (situation.percept().nearestVisible().isPresent() || situation.isLastAlive()) {
      return Optional.empty();
    }
    var graph = context.nav().graph();
    var home = graph.nearestNodeWithin(hold, 1);
    if (home.isEmpty()) return Optional.empty();
    var posts = posts(graph, new Area(home.getAsInt(), hold, radius));
    if (posts.size() < 2) return Optional.empty();
    posts.sort(Integer::compare);
    var bot = situation.self().id().value();
    var dwell = MIN_DWELL + Math.round((MAX_DWELL - MIN_DWELL) * context.style().patience());
    var visit = (situation.now() + 37L * bot) / dwell;
    return Optional.of(graph.feet(posts.get(Math.floorMod(mix(bot, visit), posts.size()))));
  }

  /** The ground about a hold: the node it stands on, its feet and how far a patrol strays. */
  private record Area(int home, Vec3 hold, double radius) {}

  /** The nodes within the area's radius of its hold that a bot can walk to from it and back. */
  private static List<Integer> posts(NavGraph graph, Area area) {
    var base = BlockPos.of(area.hold().plus(0, 0.001, 0));
    var reach = (int) Math.ceil(area.radius());
    var posts = new ArrayList<Integer>();
    for (var dx = -reach; dx <= reach; dx++) {
      for (var dz = -reach; dz <= reach; dz++) {
        for (var dy = -1; dy <= 1; dy++) {
          graph
              .nodeAt(base.offset(dx, dy, dz))
              .ifPresent(
                  node -> {
                    if (post(graph, area, node)) posts.add(node);
                  });
        }
      }
    }
    return posts;
  }

  private static boolean post(NavGraph graph, Area area, int node) {
    var feet = graph.feet(node);
    return feet.horizontalDistance(area.hold()) <= area.radius()
        && Math.abs(feet.y() - area.hold().y()) < 1.5
        && graph.reachable(area.home(), node)
        && graph.reachable(node, area.home());
  }

  /** A well-spread deterministic hash of the bot and the visit number. */
  private static long mix(int bot, long visit) {
    var h = visit * 0x9E3779B97F4A7C15L + bot * 0xC2B2AE3D27D4EB4FL;
    h ^= h >>> 31;
    h *= 0xBF58476D1CE4E5B9L;
    return h ^ (h >>> 29);
  }
}
