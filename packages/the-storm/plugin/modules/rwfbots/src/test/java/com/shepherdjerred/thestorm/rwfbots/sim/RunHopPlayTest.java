package com.shepherdjerred.thestorm.rwfbots.sim;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Loadout;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.Reflex;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexContext;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexInput;
import com.shepherdjerred.thestorm.rwfbots.domain.reflex.ReflexState;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Strategy;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
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
import org.junit.jupiter.api.Test;

/**
 * Sprint-jumping along straight runs. A body hopping a straight sprint covers ground faster, and a
 * team whose enemies are gone runs its shipped-map routes faster than the same team kept on its
 * feet, and never lands a hop hurt.
 */
final class RunHopPlayTest {
  private static final List<String> MAPS = List.of("hemispheres", "miner-dispute", "valley");
  private static final int TICKS = 1200;

  /** A route this many waypoints from its end is still a run, not the walk onto its goal. */
  private static final int RUNNING = 3;

  /** Damage this soon after a hop's launch was taken in its flight or on its landing. */
  private static final long HOP_AFTERMATH = 30;

  /** Ticks to run the lap, run hops taken, and the furthest the body strayed off its line. */
  record Lap(long ticks, int hops, double stray) {}

  @Test
  void aStraightSprintIsFasterHopping() {
    var plain = lap(false);
    var hopping = lap(true);

    assertThat(plain.hops()).isZero();
    assertThat(hopping.hops()).as("%s", hopping).isGreaterThanOrEqualTo(4);
    // Vanilla's sprint jump is about a quarter faster; the lap starts standing and walks its end.
    assertThat((double) hopping.ticks())
        .as("%s against %s", hopping, plain)
        .isLessThan(0.9 * plain.ticks());
    assertThat(hopping.stray()).isLessThan(0.05);
  }

  /** One body sprinting 25 blocks up the synthetic floor, by the reflex alone. */
  private static Lap lap(boolean hops) {
    var nav = Arenas.SYNTHETIC;
    var physics = new SimPhysics(nav);
    var body = new SimBody(new SimWorld.Spawn(1, RED, Kit.TROOPER, new Vec3(12.5, 1, 1.5)));
    var context =
        hops
            ? new ReflexContext(
                nav, levers(0.65), Loadout.standard(Kit.TROOPER), ReflexContext.Habits.NONE)
            : new ReflexContext(nav.grid(), levers(0.65), Loadout.standard(Kit.TROOPER));
    var points = new ArrayList<Waypoint>();
    for (var z = 2; z <= 30; z++) points.add(new Waypoint(new Vec3(12.5, 1, z + 0.5), Hop.WALK));
    var decision =
        new Decision(
            new CombatantId(1),
            Option.HUNT,
            Optional.empty(),
            List.copyOf(points),
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "straight run",
            0,
            1,
            Optional.empty());
    var random = new SplittableRandom(3);
    var state = ReflexState.initial(body.look);
    var hopped = 0;
    var stray = 0.0;
    for (var tick = 1L; tick < 400; tick++) {
      if (body.pos.z() >= 26.5) return new Lap(tick, hopped, stray);
      var self = body.view(tick);
      var world =
          new WorldSnapshot(
              tick,
              MatchPhase.LIVE,
              List.of(self),
              List.of(),
              PoisonView.NONE,
              nav.mapId(),
              List.of(),
              List.of(),
              List.of());
      var step =
          Reflex.tick(
              state,
              new ReflexInput(self, world, decision, Optional.empty(), 0, List.of()),
              context,
              random);
      state = step.state();
      body.previousPos = body.pos;
      for (var command : step.commands()) {
        if (apply(physics, body, command, tick)) hopped++;
      }
      physics.move(body, tick);
      stray = Math.max(stray, Math.abs(body.pos.x() - 12.5));
    }
    return new Lap(400, hopped, stray);
  }

  /** What one side's bodies did over a run. */
  private static final class Tally {
    private final List<SimBody> bodies;
    private final Map<SimBody, Double> health = new HashMap<>();
    private final Map<SimBody, Long> hopped = new HashMap<>();
    int hops;
    double hopHurt;
    double walked;
    int walkTicks;

    Tally(List<SimBody> bodies) {
      this.bodies = bodies;
      bodies.forEach(body -> health.put(body, body.health));
    }

    void observe(long tick) {
      for (var body : bodies) {
        if (body.alive) observe(body, tick);
      }
    }

    private void observe(SimBody body, long tick) {
      if (body.lastCommands.contains(new BodyCommand.Jump(true))) {
        hops++;
        hopped.put(body, tick);
      }
      if (hopped.containsKey(body) && tick - hopped.get(body) <= HOP_AFTERMATH)
        hopHurt += Math.max(0, health.get(body) - body.health);
      health.put(body, body.health);
      var waypoints = body.decision.map(Decision::waypoints).orElseGet(List::of);
      if (waypoints.size() > body.reflex.waypointIndex() + RUNNING) {
        walked += body.pos.horizontalDistance(body.previousPos);
        walkTicks++;
      }
    }
  }

  /** Applies a body command as the sim world does; returns whether it hopped. */
  private static boolean apply(SimPhysics physics, SimBody body, BodyCommand command, long tick) {
    switch (command) {
      case BodyCommand.MoveToward(var at, var sprint, var _) -> {
        body.sprinting = sprint;
        physics.steer(body, at.minus(body.pos));
      }
      case BodyCommand.Stop _ -> {
        body.sprinting = false;
        physics.steer(body, Vec3.ZERO);
      }
      case BodyCommand.Jump(var hop) -> {
        if (hop) physics.hop(body, tick);
        else physics.jump(body, tick);
        return hop;
      }
      default -> {}
    }
    return false;
  }

  /** One team's run over a shipped map. */
  record Run(int hops, double hopHurt, int deaths, double walked, int walkTicks) {}

  @Test
  void teamsRunTheirShippedRoutesFasterHoppingAndLandUnhurt() {
    var plain = new ArrayList<Run>();
    var hopping = new ArrayList<Run>();
    for (var map : MAPS) {
      var nav = Arenas.shippedNav(map);
      for (var seed = 1L; seed <= 2; seed++) {
        plain.add(run(nav, seed, false));
        hopping.add(run(nav, seed, true));
      }
    }
    assertThat(plain.stream().mapToInt(Run::hops).sum()).isZero();
    assertThat(hopping.stream().mapToInt(Run::hops).sum()).as("%s", hopping).isPositive();
    assertThat(hopping).allMatch(run -> run.hopHurt() == 0 && run.deaths() == 0);
    assertThat(speed(hopping))
        .as("m/s running: %s against %s", hopping, plain)
        .isGreaterThan(speed(plain));
  }

  private static double speed(List<Run> runs) {
    var walked = runs.stream().mapToDouble(Run::walked).sum();
    var ticks = runs.stream().mapToInt(Run::walkTicks).sum();
    return walked / ticks * 20;
  }

  /** Four bots of one side whose enemies died at the start, with or without their certified nav. */
  private static Run run(NavArtifact nav, long seed, boolean hops) {
    var world =
        Arenas.shipped(
            nav,
            seed,
            4,
            new Arenas.Sides(
                new Arenas.Lineup(Strategy.RUSH, Arenas.EIGHT),
                new Arenas.Lineup(Strategy.RUSH, Arenas.EIGHT)));
    var red = new ArrayList<SimBody>();
    for (var body : world.bodies.values()) {
      if (body.team.equals(BLUE)) body.hurt(1000, 0);
      else red.add(body);
      if (!hops && body.bot) {
        var context = body.reflexContext;
        body.reflexContext =
            new ReflexContext(
                context.grid(), context.levers(), context.loadout(), context.habits());
      }
    }
    var tally = new Tally(red);
    for (var tick = 1; tick <= TICKS; tick++) {
      world.step();
      tally.observe(world.tick);
    }
    var deaths = (int) red.stream().filter(body -> !body.alive).count();
    return new Run(tally.hops, tally.hopHurt, deaths, tally.walked, tally.walkTicks);
  }
}
