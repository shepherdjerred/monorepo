package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ActiveJump;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexContext;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.WaypointArrival;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/**
 * Production hemispheres openings showed nearly every bot leap preceded by a walk of two blocks
 * back towards its own side: the run-up started only at the takeoff, braked, and then backed up to
 * the measured run-up start. A body already running at the takeoff joins the run-up where it is.
 */
@Tag("simulation")
final class OpeningRunUpTest {
  private static final double MEASURED_MINIMUM = 0.27000001072883606;
  private static final Vec3 TAKEOFF = new Vec3(6.7, 1, 4.5);
  private static final Vec3 RUN_UP_START = new Vec3(4.7, 1, 4.5);
  private static final Waypoint GAP =
      new Waypoint(
          new Vec3(10.5, 1, 4.5),
          Hop.LEAP,
          Optional.of(new JumpLaunch(TAKEOFF, RUN_UP_START, MEASURED_MINIMUM, 13)));
  private static final Waypoint FROM = new Waypoint(new Vec3(6.5, 1, 4.5), Hop.WALK);
  private static final int OPENING_TICKS = 600;
  private static final int BACKSWING_WINDOW = 40;
  private static final double BACKSWING = 1.5;

  /** Ticks a plan takes to reach a production reflex, with the planner's margin. */
  private static final int PLAN_LATENCY = 4;

  /** The far edge of the measured launch window, blocks past the takeoff. */
  private static final double WINDOW_END = 0.18;

  /** A straight sprint along the run-up line, or one that closes a small cross-track onto it. */
  @ParameterizedTest(name = "cross-track {0}")
  @ValueSource(doubles = {0, 0.1, 0.2, 0.35, -0.3})
  void aSprintingBotOnAStraightRouteLaunchesWithoutReversingAlongTheLeap(double cross) {
    var run = new StraightRun(new Vec3(0.5, 1, 4.5 + cross));
    var route =
        decision(
            run.body.id, List.of(new Waypoint(new Vec3(2.5, 1, 4.5 + cross), Hop.WALK), FROM, GAP));
    for (var tick = 1L; tick <= 120 && !run.landed(); tick++) run.step(route, tick);
    assertThat(run.launched).as("launch tick").isPositive();
    assertThat(run.reversal).as("along-leap reversal before launch").isLessThanOrEqualTo(0.5);
    assertThat(run.landed()).as("landed at %s", run.body.pos).isTrue();
  }

  /** One body driven by the reflex alone on the synthetic floor, tracking motion along the leap. */
  private static final class StraightRun {
    final SimPhysics physics = new SimPhysics(Arenas.SYNTHETIC);
    final ReflexContext context =
        new ReflexContext(Arenas.SYNTHETIC.grid(), levers(0.65), Loadout.standard(Kit.TROOPER));
    final SplittableRandom random = new SplittableRandom(23);
    final SimBody body;
    ReflexState state;
    double furthest = Double.NEGATIVE_INFINITY;
    double reversal;
    long launched = -1;

    StraightRun(Vec3 start) {
      body = new SimBody(new SimWorld.Spawn(1, RED, Kit.TROOPER, start));
      state = ReflexState.initial(body.look);
    }

    void step(Decision route, long tick) {
      var self = body.view(tick);
      var world =
          new WorldSnapshot(
              tick,
              MatchPhase.LIVE,
              List.of(self),
              List.of(),
              PoisonView.NONE,
              Arenas.SYNTHETIC.mapId(),
              List.of(),
              List.of(),
              List.of());
      var step =
          Reflex.tick(
              state,
              new ReflexInput(self, world, route, Optional.empty(), 0, List.of(), Optional.empty()),
              context,
              random);
      state = step.state();
      body.previousPos = body.pos;
      step.commands().forEach(command -> apply(command, tick));
      if (launched < 0) {
        var along = along(self.pos(), GAP.launch().orElseThrow());
        furthest = Math.max(furthest, along);
        reversal = Math.max(reversal, furthest - along);
      }
      physics.move(body, tick);
    }

    private void apply(BodyCommand command, long tick) {
      switch (command) {
        case BodyCommand.MoveToward(var at, var sprint, var _) -> {
          body.sprinting = sprint;
          physics.steer(body, at.minus(body.pos));
        }
        case BodyCommand.Stop _ -> {
          body.sprinting = false;
          physics.steer(body, Vec3.ZERO);
        }
        case BodyCommand.Jump _ -> {
          physics.jump(body, tick);
          if (launched < 0) launched = tick;
        }
        default -> {}
      }
    }

    boolean landed() {
      return launched > 0 && WaypointArrival.reached(body.view(0), GAP);
    }
  }

  /**
   * Whole bot rosters on the map where production openings backed up before 133 of 153 leaps. The
   * route only gained a leap once its body stood on the takeoff, and a plan reaches a production
   * body a few ticks after its snapshot, by which time the body had run past the launch window.
   */
  @Test
  void hemispheresOpeningLeapsArePlannedAheadAndNeverWalkedBackFor() {
    var nav = Arenas.shippedNav("hemispheres");
    var tally = new Opening();
    for (var seed : List.of(10L, 11L, 12L)) {
      for (var blue : List.of(Strategy.RUSH, Strategy.TURTLE)) {
        var world =
            Arenas.shipped(
                nav,
                seed,
                8,
                new Arenas.Sides(
                    new Arenas.Lineup(Strategy.RUSH, Arenas.EIGHT),
                    new Arenas.Lineup(blue, Arenas.EIGHT)));
        world.run(OPENING_TICKS, tally::observe);
      }
    }
    assertThat(tally.leaps).as("opening leaps").isGreaterThanOrEqualTo(40);
    assertThat((double) tally.backswings / tally.leaps)
        .as("backswings of %s+ blocks per leap: %s", BACKSWING, tally)
        .isLessThan(0.05);
    assertThat((double) tally.late / tally.leaps)
        .as("leaps planned too late to reach within %s ticks: %s", PLAN_LATENCY, tally)
        .isLessThan(0.1);
  }

  /** Every bot leap of an opening: walked back for first, or planned too late to reach in time. */
  private static final class Opening {
    int leaps;
    int backswings;
    int late;
    final List<String> examples = new ArrayList<>();
    private final Map<String, Map<Long, Vec3>> history = new HashMap<>();
    // Where each body would be once the plan first holding each leap of its route reached it.
    private final Map<String, Map<Waypoint, Double>> planned = new HashMap<>();

    boolean observe(SimWorld world) {
      for (var body : world.bodies.values()) {
        if (body.alive) observe(world, body);
      }
      return false;
    }

    private void observe(SimWorld world, SimBody body) {
      var key = world.seed + "/" + world.strategies + "/" + body.id;
      var trail = history.computeIfAbsent(key, id -> new HashMap<>());
      trail.put(world.tick, body.pos);
      var route = planned.computeIfAbsent(key, id -> new HashMap<>());
      var leaps =
          body.decision.map(Decision::waypoints).orElseGet(List::of).stream()
              .filter(point -> point.hop() == Hop.LEAP)
              .toList();
      // A prepared or airborne jump the reflex keeps through a replan stays planned.
      var held = body.reflex.activeJump().map(ActiveJump::waypoint);
      route.keySet().removeIf(point -> !leaps.contains(point) && !held.equals(Optional.of(point)));
      for (var point : leaps) {
        var snapshot = body.decision.orElseThrow().snapshotTick();
        route.putIfAbsent(point, reached(trail, snapshot, point.launch().orElseThrow()));
      }
      body.reflex
          .activeJump()
          .filter(jump -> jump.stage() == ActiveJump.Stage.AIRBORNE)
          .filter(jump -> jump.launchTick() == world.tick)
          .ifPresent(jump -> launched(key + "@" + world.tick, jump.waypoint(), trail, route));
    }

    private void launched(
        String label, Waypoint waypoint, Map<Long, Vec3> trail, Map<Waypoint, Double> route) {
      leaps++;
      if (route.getOrDefault(waypoint, Double.POSITIVE_INFINITY) > WINDOW_END) late++;
      var jump = waypoint.launch().orElseThrow();
      var now = trail.keySet().stream().mapToLong(Long::longValue).max().orElseThrow();
      var furthest = Double.NEGATIVE_INFINITY;
      var reversal = 0.0;
      for (var tick = now - BACKSWING_WINDOW; tick < now; tick++) {
        var at = trail.get(tick);
        if (at == null) continue;
        furthest = Math.max(furthest, along(at, jump));
        reversal = Math.max(reversal, furthest - along(at, jump));
      }
      if (reversal < BACKSWING) return;
      backswings++;
      if (examples.size() < 3) examples.add(label);
    }

    @Override
    public String toString() {
      return backswings + " backswings, " + late + " late, of " + leaps + " " + examples;
    }
  }

  /**
   * How far along its leap a body will have run once a plan reaches it: from where the plan's
   * snapshot saw it, at the pace it saw.
   */
  private static double reached(Map<Long, Vec3> trail, long snapshot, JumpLaunch launch) {
    var seen = trail.getOrDefault(snapshot - 1, trail.get(snapshot));
    var before = trail.getOrDefault(snapshot - 2, seen);
    return along(seen.plus(seen.minus(before).horizontal().scale(PLAN_LATENCY)), launch);
  }

  private static double along(Vec3 at, JumpLaunch launch) {
    var direction = launch.takeoff().minus(launch.runUpStart()).horizontal().normalized();
    return at.minus(launch.takeoff()).horizontal().dot(direction);
  }

  private static Decision decision(CombatantId bot, List<Waypoint> waypoints) {
    return new Decision(
        bot,
        Option.HUNT,
        Optional.empty(),
        waypoints,
        Stance.AGGRESSIVE,
        Optional.empty(),
        Optional.empty(),
        Optional.empty(),
        "straight run-up",
        0,
        1,
        Optional.empty());
  }
}
