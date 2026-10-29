package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockClassification;
import com.shepherdjerred.thestorm.rwfbots.domain.map.BlockShape;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.MapBaker;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavArtifact;
import com.shepherdjerred.thestorm.rwfbots.domain.map.NavSites;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.JumpLaunch;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.TraversalState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** When a running body sprint-jumps along its route, and when it keeps its feet on the ground. */
final class RunHopTest {

  /**
   * A stone floor with five north-south lanes: one in the open (x=4), one beside a wall (x=10), one
   * beside a fence (x=14), one beside a pit (x=18) and one under a three-high ceiling (x=26).
   */
  private static final class Lanes implements BlockClassification {
    private final GridBounds bounds = new GridBounds(new BlockPos(0, 0, 0), 32, 8, 32);

    @Override
    public GridBounds bounds() {
      return bounds;
    }

    @Override
    public BlockShape shape(int x, int y, int z) {
      if (y == 0) return x == 19 || x == 20 ? BlockShape.PASSABLE : BlockShape.FULL;
      if (x == 11 && y <= 3) return BlockShape.FULL;
      if (x == 15 && y == 1) return z < 16 ? BlockShape.FENCE : BlockShape.FULL;
      if (y == 3 && x >= 25 && x <= 27 && z >= 8 && z <= 24) return BlockShape.FULL;
      return BlockShape.PASSABLE;
    }

    @Override
    public boolean blocksSight(int x, int y, int z) {
      return shape(x, y, z).blocksMovement();
    }
  }

  private static final NavArtifact NAV =
      MapBaker.bake("lanes", new Lanes(), new NavSites(List.of(), List.of()));

  private static final double OPEN = 4.5;
  private static final double WALL = 10.5;
  private static final double PIT = 18.5;
  private static final double FENCE = 14.5;
  private static final double LOW = 26.5;
  private static final long NOW = 100;

  private static ReflexContext context(ReflexContext.Habits habits, double skill) {
    return new ReflexContext(NAV, levers(skill), Loadout.standard(Kit.TROOPER), habits);
  }

  private static final ReflexContext RUNNER = context(ReflexContext.Habits.NONE, 0.65);

  /** A trooper running north at full sprint along lane {@code x}, at {@code z}. */
  private static CombatantView runner(double x, double z) {
    return combatant(1, RED, new Vec3(x, 1, z))
        .withVel(new Vec3(0, 0, 0.28))
        .withMotion(true, true);
  }

  /** A straight walk up lane {@code x} from {@code z} for {@code blocks} waypoints. */
  private static List<Waypoint> lane(double x, double z, int blocks) {
    var points = new ArrayList<Waypoint>();
    for (var i = 1; i <= blocks; i++) points.add(new Waypoint(new Vec3(x, 1, z + i), Hop.WALK));
    return points;
  }

  private static Decision route(List<Waypoint> points, Stance stance) {
    return new Decision(
        new com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId(1),
        Option.HUNT,
        Optional.empty(),
        points,
        stance,
        Optional.empty(),
        Optional.empty(),
        Optional.empty(),
        "run",
        NOW,
        1,
        Optional.empty());
  }

  private static List<BodyCommand> tick(
      CombatantView self, Decision decision, ReflexContext context, List<CombatantView> seen) {
    var views = new ArrayList<CombatantView>();
    views.add(self);
    views.addAll(seen);
    var world =
        new WorldSnapshot(
            NOW,
            MatchPhase.LIVE,
            views,
            List.of(),
            PoisonView.NONE,
            "lanes",
            List.of(),
            List.of(),
            List.of());
    return Reflex.tick(
            ReflexState.initial(Facing.SOUTH).withPath(0, NOW),
            new ReflexInput(self, world, decision, Optional.empty(), 0, seen),
            context,
            new SplittableRandom(5))
        .commands();
  }

  private static List<BodyCommand> run(CombatantView self, List<Waypoint> points) {
    return tick(self, route(points, Stance.AGGRESSIVE), RUNNER, List.of());
  }

  private static boolean hops(List<BodyCommand> commands) {
    return commands.contains(new BodyCommand.Jump(true));
  }

  @Test
  void aBodySprintingAStraightRunHopsAlongIt() {
    var commands = run(runner(OPEN, 4.5), lane(OPEN, 4.5, 16));

    assertThat(hops(commands)).as("%s", commands).isTrue();
    var move =
        commands.stream()
            .filter(BodyCommand.MoveToward.class::isInstance)
            .map(BodyCommand.MoveToward.class::cast)
            .findFirst()
            .orElseThrow();
    assertThat(move.sprint()).isTrue();
    assertThat(move.waypoint().x()).as("steers along the line").isEqualTo(OPEN);
    assertThat(commands.indexOf(move)).isLessThan(commands.indexOf(new BodyCommand.Jump(true)));
  }

  @Test
  void aWallBesideTheRunIsNoReasonToStayGrounded() {
    assertThat(hops(run(runner(WALL, 4.5), lane(WALL, 4.5, 16)))).isTrue();
  }

  @Test
  void aBodyNeverHopsAlongADropOrUnderALowCeiling() {
    assertThat(hops(run(runner(PIT, 4.5), lane(PIT, 4.5, 16)))).as("beside a pit").isFalse();
    assertThat(hops(run(runner(FENCE, 4.5), lane(FENCE, 4.5, 16)))).as("beside a fence").isFalse();
    assertThat(hops(run(runner(FENCE, 16.5), lane(FENCE, 16.5, 12)))).as("beside a rail").isFalse();
    assertThat(hops(run(runner(LOW, 10.5), lane(LOW, 10.5, 12)))).as("under a ceiling").isFalse();
  }

  @Test
  void aBodyHopsOnlyWithEnoughStraightLevelPathAhead() {
    // The last waypoints are walked in, and a hop needs its flight and its landing on the line.
    assertThat(hops(run(runner(OPEN, 4.5), lane(OPEN, 4.5, 8)))).as("short route").isFalse();
    var turning = new ArrayList<>(lane(OPEN, 4.5, 4));
    for (var i = 1; i <= 12; i++) turning.add(new Waypoint(new Vec3(OPEN + i, 1, 8.5), Hop.WALK));
    assertThat(hops(run(runner(OPEN, 4.5), turning))).as("a turn ahead").isFalse();
    var stepping = new ArrayList<>(lane(OPEN, 4.5, 3));
    stepping.add(new Waypoint(new Vec3(OPEN, 2, 8.5), Hop.JUMP));
    stepping.addAll(
        lane(OPEN, 8.5, 12).stream()
            .map(p -> new Waypoint(p.pos().plus(0, 1, 0), Hop.WALK))
            .toList());
    assertThat(hops(run(runner(OPEN, 4.5), stepping))).as("a step ahead").isFalse();
  }

  @Test
  void aBodyKeepsALeapsRunUpForTheLeap() {
    var points = new ArrayList<>(lane(OPEN, 4.5, 7));
    var takeoff = new Vec3(OPEN, 1, 11.7);
    points.add(
        new Waypoint(
            new Vec3(OPEN, 1, 15.5),
            Hop.LEAP,
            Optional.of(new JumpLaunch(takeoff, takeoff.plus(0, 0, -2), 0.27, 13))));
    points.addAll(lane(OPEN, 15.5, 12));
    assertThat(hops(run(runner(OPEN, 4.5), points))).isFalse();
  }

  @Test
  void aStandingOrTurningBodyRunsBeforeItHops() {
    var standing = combatant(1, RED, new Vec3(OPEN, 1, 4.5)).withMotion(true, true);
    assertThat(hops(run(standing, lane(OPEN, 4.5, 16)))).as("standing start").isFalse();
    var across =
        combatant(1, RED, new Vec3(OPEN, 1, 4.5))
            .withVel(new Vec3(0.28, 0, 0))
            .withMotion(true, true);
    assertThat(hops(run(across, lane(OPEN, 4.5, 16)))).as("still turning onto it").isFalse();
  }

  @Test
  void anEnemyCloseByKeepsTheBodyOnItsFeetUnlessItBunnyHops() {
    var self = runner(OPEN, 4.5);
    var points = lane(OPEN, 4.5, 16);
    var near = combatant(9, BLUE, new Vec3(OPEN + 12, 1, 4.5));
    var close = combatant(9, BLUE, new Vec3(OPEN + 3, 1, 4.5));
    var far = combatant(9, BLUE, new Vec3(OPEN + 18, 1, 4.5));
    var decision = route(points, Stance.AGGRESSIVE);
    assertThat(hops(tick(self, decision, RUNNER, List.of(near)))).isFalse();
    assertThat(hops(tick(self, decision, RUNNER, List.of(far)))).isTrue();
    var hopper = context(new ReflexContext.Habits(false, Reflex.EAT_BELOW, true), 0.65);
    assertThat(hops(tick(self, decision, hopper, List.of(near)))).isTrue();
    assertThat(hops(tick(self, decision, hopper, List.of(close)))).isFalse();
  }

  @Test
  void aBodyWithAFightOnItsHandsNeverHopsEvenAtATargetOutOfSight() {
    var fight =
        new Decision(
            new com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId(1),
            Option.ENGAGE,
            Optional.of(new com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId(9)),
            lane(OPEN, 4.5, 16),
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "engage:fight",
            NOW,
            1,
            Optional.empty());
    assertThat(hops(tick(runner(OPEN, 4.5), fight, RUNNER, List.of()))).isFalse();
  }

  @Test
  void beginnersRunWithoutHoppingButABunnyHopperHopsAtAnySkill() {
    var self = runner(OPEN, 4.5);
    var decision = route(lane(OPEN, 4.5, 16), Stance.AGGRESSIVE);
    assertThat(hops(tick(self, decision, context(ReflexContext.Habits.NONE, 0.2), List.of())))
        .isFalse();
    assertThat(
            hops(
                tick(
                    self,
                    decision,
                    context(new ReflexContext.Habits(false, Reflex.EAT_BELOW, true), 0.2),
                    List.of())))
        .isTrue();
  }

  @Test
  void aBodyThatDoesNotSprintOrHasNoCertifiedMapNeverHops() {
    var self = runner(OPEN, 4.5);
    var points = lane(OPEN, 4.5, 16);
    assertThat(hops(tick(self, route(points, Stance.CAUTIOUS), RUNNER, List.of())))
        .as("a cautious walk")
        .isFalse();
    var juggernaut =
        self.withTraversal(
            new TraversalState(false, 3, 1, 0, -1, -1, -1, -1, 0, -1, -1, -1, -1, 20, 0));
    assertThat(hops(run(juggernaut, points))).as("a kit that may not sprint").isFalse();
    var unmapped = new ReflexContext(NAV.grid(), levers(0.65), Loadout.standard(Kit.TROOPER));
    assertThat(hops(tick(self, route(points, Stance.AGGRESSIVE), unmapped, List.of())))
        .as("no nav")
        .isFalse();
  }

  @Test
  void jumpBoostAndSlowFallingChangeTheArcSoTheyKeepTheBodyGrounded() {
    var points = lane(OPEN, 4.5, 16);
    var boosted =
        runner(OPEN, 4.5)
            .withTraversal(
                new TraversalState(true, 3, 1, 0, -1, -1, -1, -1, 0, -1, -1, 1, NOW + 100, 20, 0));
    assertThat(hops(run(boosted, points))).as("jump boost").isFalse();
    var floating =
        runner(OPEN, 4.5)
            .withTraversal(
                new TraversalState(true, 3, 1, 0, -1, -1, -1, NOW + 100, 0, -1, -1, -1, -1, 20, 0));
    assertThat(hops(run(floating, points))).as("slow falling").isFalse();
  }

  @Test
  void aHopFliesOverTheWaypointsBelowItRatherThanTurningBackForThem() {
    var points = lane(OPEN, 4.5, 8);
    var flying =
        combatant(1, RED, new Vec3(OPEN, 2.1, 6.9))
            .withVel(new Vec3(0, 0.1, 0.3))
            .withMotion(true, false);
    // Waypoint 1 (z=6.5) lies under and behind the body: flown over.
    assertThat(RunHop.overflown(flying, points, 1, 5)).isTrue();
    // Waypoint 3 (z=8.5) is still ahead.
    assertThat(RunHop.overflown(flying, points, 3, 5)).isFalse();
    assertThat(RunHop.overflown(flying.withMotion(true, true), points, 1, 5))
        .as("landed")
        .isFalse();
    assertThat(RunHop.overflown(flying, points, 1, RunHop.FLIGHT_TICKS + 1)).as("a fall").isFalse();
  }

  @Test
  void theHopCorridorAdmitsWallsAndRefusesOpenings() {
    var direction = new Vec3(0, 0, 1);
    assertThat(CombatFootwork.safeHop(NAV, runner(OPEN, 4.5), direction, NOW)).isTrue();
    assertThat(CombatFootwork.safeHop(NAV, runner(WALL, 4.5), direction, NOW)).isTrue();
    assertThat(CombatFootwork.safeHop(NAV, runner(PIT, 4.5), direction, NOW)).isFalse();
    assertThat(CombatFootwork.safeHop(NAV, runner(FENCE, 4.5), direction, NOW)).isFalse();
    assertThat(CombatFootwork.safeHop(NAV, runner(LOW, 10.5), direction, NOW)).isFalse();
    // Running at the pit rather than along it.
    assertThat(CombatFootwork.safeHop(NAV, runner(16.5, 4.5), new Vec3(1, 0, 0), NOW)).isFalse();
  }
}
