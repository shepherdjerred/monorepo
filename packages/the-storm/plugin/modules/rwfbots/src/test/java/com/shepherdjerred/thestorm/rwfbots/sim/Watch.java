package com.shepherdjerred.thestorm.rwfbots.sim;

import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.tactics.Planner;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TeamId;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Measures how a sim match is played, tick by tick: how far each bot is from its nearest teammate,
 * how many teammates crowd one spot, how wide each team spreads across its line of advance, which
 * lanes its slots use, whether bots that see an enemy get into claimed cover, and at what range
 * each archetype fights.
 */
final class Watch {

  /** The opening the spread is measured over: 20 s. */
  static final long OPENING_TICKS = 400;

  /**
   * Teammates closer than this crowd one spot. Strictly closer: rwf's spawn points stand exactly
   * two blocks apart.
   */
  static final double CROWD_RADIUS = 2;

  /** More teammates than this within {@link #CROWD_RADIUS} of one of them is a crowd. */
  static final int MAX_CROWD = 3;

  /** How long a bot that sees an enemy has to get into cover: 3 s. */
  static final long COVER_TICKS = 60;

  /** Within this of a claimed cover point counts as in cover. */
  static final double IN_COVER = 1;

  private final SimWorld world;
  private final Set<Integer> coverNodes = new HashSet<>();
  private final Map<TeamId, List<Double>> nearest = new HashMap<>();
  private final Map<TeamId, Double> widest = new HashMap<>();
  private final Map<TeamId, Set<Integer>> lanes = new HashMap<>();
  private final Map<CombatantId, Long> firstSeen = new HashMap<>();
  private final Set<CombatantId> tookCover = new HashSet<>();
  private final Map<Archetype, List<Double>> ranges = new EnumMap<>(Archetype.class);
  private int maxCrowd;
  private int teamTicks;
  private int crowdedTeamTicks;

  Watch(SimWorld world) {
    this.world = world;
    world.nav.cover().points().forEach(point -> coverNodes.add(point.node()));
  }

  /** Records the current tick; use as the {@link SimWorld#run} predicate. */
  boolean observe(SimWorld unused) {
    if (world.boards.isEmpty()) {
      return false;
    }
    var tick = world.tick;
    var alive = world.bodies.values().stream().filter(body -> body.alive && body.bot).toList();
    if (tick <= OPENING_TICKS) {
      spread(alive);
    }
    for (var body : alive) {
      cover(body, tick);
      body.decision
          .filter(decision -> decision.option() == Option.ENGAGE && body.nearestSeen >= 0)
          .ifPresent(
              decision ->
                  ranges
                      .computeIfAbsent(body.archetype, a -> new ArrayList<>())
                      .add(body.nearestSeen));
    }
    world.boards.forEach(
        (team, board) ->
            board.plan().assignment().values().stream()
                .flatMap(key -> board.plan().slot(key).stream())
                .filter(slot -> slot.lane() >= 0)
                .forEach(
                    slot -> lanes.computeIfAbsent(team, t -> new HashSet<>()).add(slot.lane())));
    return false;
  }

  private void spread(List<SimBody> alive) {
    var crowdedTeams = new HashSet<TeamId>();
    var teams = new HashSet<TeamId>();
    for (var body : alive) {
      teams.add(body.team);
      var best = nearestTeammate(body, alive);
      var crowd = crowdAround(body, alive);
      if (Double.isFinite(best)) {
        nearest.computeIfAbsent(body.team, t -> new ArrayList<>()).add(best);
      }
      maxCrowd = Math.max(maxCrowd, crowd);
      if (crowd > MAX_CROWD) {
        crowdedTeams.add(body.team);
      }
    }
    teamTicks += teams.size();
    crowdedTeamTicks += crowdedTeams.size();
    var byTeam = new HashMap<TeamId, double[]>();
    for (var body : alive) {
      var range = byTeam.computeIfAbsent(body.team, t -> new double[] {1e9, -1e9});
      range[0] = Math.min(range[0], body.pos.z());
      range[1] = Math.max(range[1], body.pos.z());
    }
    byTeam.forEach((team, range) -> widest.merge(team, range[1] - range[0], Math::max));
  }

  private static double nearestTeammate(SimBody body, List<SimBody> alive) {
    var best = Double.POSITIVE_INFINITY;
    for (var other : alive) {
      if (other != body && other.team.equals(body.team)) {
        best = Math.min(best, other.pos.horizontalDistance(body.pos));
      }
    }
    return best;
  }

  /** {@code body} and its teammates closer than {@link #CROWD_RADIUS}. */
  private static int crowdAround(SimBody body, List<SimBody> alive) {
    var crowd = 1;
    for (var other : alive) {
      if (other != body
          && other.team.equals(body.team)
          && other.pos.horizontalDistance(body.pos) < CROWD_RADIUS) {
        crowd++;
      }
    }
    return crowd;
  }

  private void cover(SimBody body, long tick) {
    var home = world.boards.get(body.team).plan().home();
    var outOfSpawn =
        home.map(at -> at.horizontalDistance(body.pos) >= Planner.SPAWN_CLEAR).orElse(true);
    if (body.seesEnemy && body.nearestSeen <= Planner.CONTACT_RANGE && outOfSpawn) {
      firstSeen.putIfAbsent(body.id, tick);
    }
    var seen = firstSeen.get(body.id);
    if (seen == null || tick - seen > COVER_TICKS || tookCover.contains(body.id)) {
      return;
    }
    var claim = world.boards.get(body.team).claimedCover().get(body.id);
    if (claim != null
        && coverNodes.contains(claim)
        && world.nav.graph().feet(claim).horizontalDistance(body.pos) <= IN_COVER) {
      tookCover.add(body.id);
    }
  }

  /** Every nearest-teammate distance of {@code team} over the opening, one per bot per tick. */
  List<Double> nearest(TeamId team) {
    return nearest.getOrDefault(team, List.of());
  }

  static double mean(List<Double> values) {
    return values.stream().mapToDouble(Double::doubleValue).average().orElseThrow();
  }

  int maxCrowd() {
    return maxCrowd;
  }

  /** Team-ticks of the opening measured. */
  int teamTicks() {
    return teamTicks;
  }

  /** Team-ticks of the opening in which some spot held more than {@link #MAX_CROWD} of a team. */
  int crowdedTeamTicks() {
    return crowdedTeamTicks;
  }

  /** The widest {@code team} spread across the map's z axis during the opening. */
  double widest(TeamId team) {
    return widest.getOrDefault(team, 0.0);
  }

  /** The distinct lanes {@code team}'s slots used. */
  int lanesUsed(TeamId team) {
    return lanes.getOrDefault(team, Set.of()).size();
  }

  /** Bots that saw an enemy with time left to react, and those that reached claimed cover. */
  record CoverTally(int saw, int covered) {}

  CoverTally cover(long endTick) {
    var saw = 0;
    var covered = 0;
    for (var entry : firstSeen.entrySet()) {
      if (entry.getValue() + COVER_TICKS > endTick) {
        continue;
      }
      saw++;
      if (tookCover.contains(entry.getKey())) {
        covered++;
      }
    }
    return new CoverTally(saw, covered);
  }

  /** Every range {@code archetype} fought at. */
  List<Double> ranges(Archetype archetype) {
    return ranges.getOrDefault(archetype, List.of());
  }

  static double median(List<Double> values) {
    var sorted = values.stream().sorted().toList();
    return sorted.get(sorted.size() / 2);
  }
}
