package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;
import java.util.Optional;

/**
 * Sprint-jumping along a straight run, as players do between fights. A sprint jump's boost and the
 * air's lighter drag carry a body about a quarter faster than sprinting on flat ground (the
 * Minecraft Wiki's Transportation page: 7.13 against 5.61 m/s). Air steering is weak, so a body
 * hops only where its path runs straight and level on for more than a flight and its landing, on
 * certified ground with clear headroom ({@link CombatFootwork#safeJump}), and never close enough to
 * an enemy to have to fight it from the air.
 */
public final class RunHop {

  /** Straight, level path a hop needs ahead, in blocks: a flight of about 3.7 and room to land. */
  public static final double STRAIGHT_RUN = 6;

  /** A bunny hopper takes any straight run its flight fits on. */
  public static final double BUNNY_RUN = 4.5;

  /**
   * No hop with an enemy in sight this close: the fight, not the run, decides the footwork. An
   * enemy running in meets a body hopping at it within a second or two of 16 blocks, and a hop
   * leaves the body in the air, unable to strafe. At 8 blocks, eight-against-four sim teams armed
   * within 40 s in 584 of 768 matches against main's 618; at 16 they arm in 610.
   */
  public static final double ENEMY_CLEAR = 16;

  /** A bunny hopper keeps hopping until it is nearly in a fight. */
  public static final double BUNNY_ENEMY_CLEAR = Reflex.MELEE_ALERT;

  /** Below this technique a bot runs without hopping, as most casual players do. */
  public static final double MIN_TECHNIQUE = 0.3;

  /**
   * A path point further than this off the straight line ends the run, in blocks: a line at any
   * angle passes within this of the grid steps the route takes along it.
   */
  static final double LINE_SLACK = 0.75;

  /** A path point higher or lower than the body by more than this ends the run: a step or slab. */
  static final double LEVEL = 0.01;

  /** How much further than a hop's run the path is searched for a leap's run-up, in blocks. */
  static final double LEAP_CLEAR = 8;

  /**
   * The body already runs along the line: its travel lies within 20 degrees of it, the most a body
   * following a diagonal's grid steps swings either side.
   */
  static final double ALIGNED = Math.cos(Math.toRadians(20));

  /** And nearly at full sprint, so the launch carries no turn or standing start. */
  static final double RUNNING = 0.22;

  /** How far along its line a hopping body steers, in blocks. */
  static final double STEER_AHEAD = 2;

  private static final int LOOK_AHEAD = 16;

  private RunHop() {}

  /** Jumps on the route are at least this many ticks apart. */
  static final long JUMP_COOLDOWN = 10;

  /** A step's jump launches within this horizontal distance of its waypoint, in blocks. */
  private static final double STEP_REACH = 1.2;

  /**
   * A body's walk along its route this tick.
   *
   * @param input the tick's input
   * @param state the reflex state before the tick's jump
   * @param index the waypoint walked to
   * @param sprint whether the walk sprints
   */
  record Run(ReflexInput input, ReflexState state, int index, boolean sprint) {
    CombatantView self() {
      return input.self();
    }

    List<Waypoint> waypoints() {
      return input.decision().waypoints();
    }

    long now() {
      return input.snapshot().tick();
    }

    long sinceJump() {
      return now() - state.lastJumpTick();
    }
  }

  /**
   * Where the walk steers this tick and the jump it takes, if any.
   *
   * @param steer the point to move towards
   * @param jump a step's jump up to its waypoint or a hop along a straight run
   */
  record Launch(Vec3 steer, Optional<BodyCommand.Jump> jump) {}

  /**
   * The walk's jump this tick, towards {@code destination}: a step's jump within reach of its
   * waypoint, or else a hop along a straight run ({@link #line}), steered along the line so its
   * boost follows the run rather than the next grid step of a diagonal.
   */
  static Launch launch(ReflexContext context, Run run, Vec3 destination) {
    var self = run.self();
    var waypoint = run.waypoints().get(run.index());
    if (run.sinceJump() <= JUMP_COOLDOWN) return new Launch(destination, Optional.empty());
    if (waypoint.hop() == Hop.JUMP) {
      var step = self.onGround() && self.pos().horizontalDistance(waypoint.pos()) <= STEP_REACH;
      return new Launch(destination, step ? Optional.of(new BodyCommand.Jump()) : Optional.empty());
    }
    return line(context, run)
        .map(
            direction ->
                new Launch(
                    self.pos().plus(direction.scale(STEER_AHEAD)),
                    Optional.of(new BodyCommand.Jump(true))))
        .orElseGet(() -> new Launch(destination, Optional.empty()));
  }

  /** Coming down from its own jump, which a player holds sprint through, rather than a fall. */
  static boolean ownFlight(CombatantView self, long sinceJump) {
    return sinceJump <= FLIGHT_TICKS && self.traversal().fallDistance() <= APEX;
  }

  /**
   * The straight line the body sprint-jumps along now, if it hops: a sprinting, running body with
   * the technique for it, no fight to take, no enemy near and no leap in hand, on a straight, level
   * run its hop's corridor is safe along ({@link CombatFootwork#safeHop}).
   */
  static Optional<Vec3> line(ReflexContext context, Run run) {
    var self = run.self();
    if (context.nav().isEmpty()
        || !run.sprint()
        || !self.traversal().maySprint()
        || !self.onGround()
        || self.traversal().fallDistance() > 0
        || run.state().activeJump().isPresent()
        // A fight's target, seen or remembered, is the footwork's business, not the run's.
        || run.input().decision().target().isPresent()
        || CombatFootwork.reeling(self, run.now())
        || !(context.habits().bunnyHops() || context.levers().technique() >= MIN_TECHNIQUE)
        || enemyNear(run.input(), context.habits().bunnyHops() ? BUNNY_ENEMY_CLEAR : ENEMY_CLEAR))
      return Optional.empty();
    var nav = context.nav().orElseThrow();
    if (!openFooting(nav, self.pos())) return Optional.empty();
    var travel = self.vel().horizontal();
    if (travel.length() < RUNNING) return Optional.empty();
    return straight(run, context.habits().bunnyHops() ? BUNNY_RUN : STRAIGHT_RUN)
        .filter(direction -> travel.normalized().dot(direction) >= ALIGNED)
        .filter(direction -> CombatFootwork.safeHop(nav, self, direction, run.now()));
  }

  private static boolean enemyNear(ReflexInput input, double clear) {
    var at = input.self().pos();
    return input.target().stream().anyMatch(enemy -> enemy.pos().distance(at) <= clear)
        || input.perceived().stream().anyMatch(enemy -> enemy.pos().distance(at) <= clear);
  }

  /** A sprint jump's flight lasts this long at most, in ticks: 12 on the level. */
  static final long FLIGHT_TICKS = 20;

  /** The highest a body flies over a level waypoint, in blocks: a jump's apex. */
  static final double APEX = 1.3;

  /**
   * Whether a body in a jump's flight has flown over the level walk waypoint at {@code index}:
   * above it, within its arrival radius or past it towards the next one. A waypoint counts as
   * reached only within 0.65 blocks of its height, so without this a hop that flew over the next
   * few waypoints turned the body back for them once it landed.
   */
  static boolean overflown(
      CombatantView self, List<Waypoint> waypoints, int index, long sinceJump) {
    var point = waypoints.get(index);
    var above = self.pos().y() - point.pos().y();
    if (self.onGround()
        || sinceJump > FLIGHT_TICKS
        || point.hop() != Hop.WALK
        || above < 0
        || above > APEX) return false;
    if (self.pos().horizontalDistance(point.pos()) <= ARRIVAL) return true;
    if (index + 1 >= waypoints.size()) return false;
    var next = waypoints.get(index + 1).pos().minus(point.pos()).horizontal();
    var offset = self.pos().minus(point.pos()).horizontal();
    if (next.isZero() || offset.dot(next) <= 0) return false;
    var direction = next.normalized();
    return Math.abs(offset.x() * direction.z() - offset.z() * direction.x()) <= LINE_SLACK;
  }

  /** {@link WaypointArrival}'s horizontal radius for a ground waypoint. */
  private static final double ARRIVAL = 0.45;

  /** Neither water nor a ladder or vine: a jump there swims or climbs instead. */
  private static boolean openFooting(NavArtifact nav, Vec3 feet) {
    var cell = BlockPos.of(feet);
    var node = nav.graph().nodeAt(cell);
    return node.isPresent()
        && !nav.graph().water().contains(cell)
        && !nav.graph().climbable(node.getAsInt());
  }

  /**
   * The direction of the straight, level walk ahead of the body when it runs on for at least {@code
   * needed} blocks before the final waypoints, a step, a drop or a leap's run-up.
   */
  static Optional<Vec3> straight(Run run, double needed) {
    var origin = run.self().pos();
    var points = run.waypoints();
    var last = Math.min(points.size() - 1 - Reflex.FINAL_STRAIGHT, run.index() + LOOK_AHEAD);
    if (run.index() > last || leapAhead(run, needed)) return Optional.empty();
    Optional<Vec3> best = Optional.empty();
    for (var end = run.index(); end <= last; end++) {
      var point = points.get(end);
      if (point.hop() != Hop.WALK || Math.abs(point.pos().y() - origin.y()) > LEVEL) break;
      var span = point.pos().minus(origin).horizontal();
      if (span.isZero()) continue;
      var direction = span.normalized();
      if (!onLine(points.subList(run.index(), end + 1), origin, direction)) break;
      if (span.length() >= needed) best = Optional.of(direction);
    }
    return best;
  }

  private static boolean onLine(List<Waypoint> points, Vec3 origin, Vec3 direction) {
    var along = 0.0;
    for (var point : points) {
      var offset = point.pos().minus(origin).horizontal();
      var forward = offset.dot(direction);
      var across = Math.abs(offset.x() * direction.z() - offset.z() * direction.x());
      if (across > LINE_SLACK || forward < along - LINE_SLACK) return false;
      along = Math.max(along, forward);
    }
    return true;
  }

  /**
   * Whether a leap's run-up starts within {@code needed} blocks of path ahead, where a hop could
   * land on it: the leap's own controller runs that line.
   */
  private static boolean leapAhead(Run run, double needed) {
    var points = run.waypoints();
    var at = run.self().pos();
    var travelled = 0.0;
    for (var i = run.index(); i < points.size() && travelled < needed + LEAP_CLEAR; i++) {
      var point = points.get(i);
      travelled += at.horizontalDistance(point.pos());
      at = point.pos();
      if (point.hop() == Hop.LEAP) {
        var launch = point.launch().orElseThrow();
        var runUp = launch.takeoff().horizontalDistance(launch.runUpStart());
        var flight = launch.takeoff().horizontalDistance(point.pos());
        if (travelled - flight - runUp < needed) return true;
      }
    }
    return false;
  }
}
