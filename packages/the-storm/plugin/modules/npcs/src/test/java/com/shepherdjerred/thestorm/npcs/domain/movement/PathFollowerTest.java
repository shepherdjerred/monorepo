package com.shepherdjerred.thestorm.npcs.domain.movement;

import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.MOVEMENT;
import static com.shepherdjerred.thestorm.npcs.domain.Fixtures.spot;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.shepherdjerred.thestorm.npcs.domain.brain.Intent;
import com.shepherdjerred.thestorm.npcs.domain.geo.Rotation;
import com.shepherdjerred.thestorm.npcs.domain.geo.Spot;
import com.shepherdjerred.thestorm.npcs.domain.geo.Vec3;
import com.shepherdjerred.thestorm.npcs.domain.movement.Observation.Path;
import com.shepherdjerred.thestorm.npcs.domain.movement.PathFollower.At;
import com.shepherdjerred.thestorm.npcs.domain.movement.Walker.Phase;
import com.shepherdjerred.thestorm.npcs.domain.npc.NpcPose;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

final class PathFollowerTest {

  private static final Vec3 ORIGIN = new Vec3(0.5, 64, 0.5);
  private static final Spot SHOP = spot(0.5, 64, 4.5, 90);

  private final PathFollower follower = new PathFollower(MOVEMENT, new SplittableRandom(7));

  private static Observation seen(long tick, Vec3 position) {
    return new Observation(tick, position, Rotation.SOUTH, Optional.empty(), Optional.empty());
  }

  private static Observation seen(long tick, Vec3 position, Path path) {
    return new Observation(tick, position, Rotation.SOUTH, Optional.of(path), Optional.empty());
  }

  /** Waypoints one block apart on a straight line from {@code from} to {@code to}. */
  private static Path straight(Vec3 from, Vec3 to, boolean reaches) {
    var points = new ArrayList<Vec3>();
    var steps = (int) Math.ceil(from.distance(to));
    for (var i = 1; i <= steps; i++) {
      points.add(from.towards(to, i));
    }
    return new Path(points, reaches);
  }

  /** A little world: moves the NPC as told and answers path requests with {@code paths}. */
  private static final class Sim {
    final PathFollower follower;
    final Function<Vec3, Optional<Path>> paths;
    final List<Move> moves = new ArrayList<>();
    Vec3 position;
    Walker walker;
    long tick;

    Sim(PathFollower follower, Walker walker, Vec3 position, Function<Vec3, Optional<Path>> paths) {
      this.follower = follower;
      this.walker = walker;
      this.position = position;
      this.paths = paths;
    }

    void step() {
      tick++;
      var path = walker.pathTarget().flatMap(target -> paths.apply(position));
      var result =
          follower.tick(
              walker, new Observation(tick, position, Rotation.SOUTH, path, Optional.empty()));
      walker = result.walker();
      for (var move : result.moves()) {
        moves.add(move);
        switch (move) {
          case Move.Step(var to, var _) -> {
            assertThat(position.distance(to)).isLessThanOrEqualTo(MOVEMENT.speed() + 1.0e-9);
            position = to;
          }
          case Move.Teleport(var to, var _) -> position = to;
          default -> {}
        }
      }
    }

    void runUntilResting(int limit) {
      for (var i = 0; i < limit && walker.moving(); i++) {
        step();
      }
      assertThat(walker.moving()).as("resting within %d ticks", limit).isFalse();
    }
  }

  @Test
  void startingAtTheDestinationSettlesAtOnce() {
    var tick =
        follower.start(
            new Intent.Stand(SHOP, NpcPose.SNEAKING), new At(SHOP.position(), Rotation.SOUTH), 0);
    assertThat(tick.walker().phase()).isEqualTo(new Phase.Resting(Long.MAX_VALUE));
    assertThat(tick.moves()).containsExactly(new Move.Settle(SHOP.rotation(), NpcPose.SNEAKING));
  }

  @Test
  void startingElsewhereStandsUpAndAsksForAPath() {
    var tick =
        follower.start(new Intent.Stand(SHOP, NpcPose.STANDING), new At(ORIGIN, Rotation.SOUTH), 0);
    assertThat(tick.walker().phase()).isEqualTo(new Phase.Planning(SHOP.position(), 0, 0));
    assertThat(tick.walker().pathTarget()).contains(SHOP.position());
    assertThat(tick.moves()).containsExactly(new Move.Settle(Rotation.SOUTH, NpcPose.STANDING));
  }

  @Test
  void walksAPathAtWalkingSpeedAndSettlesFacingThePlace() {
    var start =
        follower.start(new Intent.Stand(SHOP, NpcPose.STANDING), new At(ORIGIN, Rotation.SOUTH), 0);
    var sim =
        new Sim(
            follower,
            start.walker(),
            ORIGIN,
            from -> Optional.of(straight(from, SHOP.position(), true)));
    sim.runUntilResting(100);
    assertThat(sim.position).isEqualTo(SHOP.position());
    // 4 blocks at 0.2 per tick.
    assertThat(sim.tick).isBetween(20L, 25L);
    assertThat(sim.moves.getFirst()).isEqualTo(new Move.ReleaseNavigator());
    assertThat(sim.moves.getLast()).isEqualTo(new Move.Settle(SHOP.rotation(), NpcPose.STANDING));
    assertThat(sim.moves).noneMatch(Move.Teleport.class::isInstance);
    var firstStep = (Move.Step) sim.moves.get(1);
    assertThat(firstStep.facing().yaw()).isCloseTo(0f, within(1.0e-3f));
  }

  @Test
  void waitsForTheNavigatorThenTeleportsWhenNoPathComes() {
    var start =
        follower.start(new Intent.Stand(SHOP, NpcPose.STANDING), new At(ORIGIN, Rotation.SOUTH), 0);
    var walker = start.walker();
    for (var t = 1; t < MOVEMENT.pathAttempts(); t++) {
      var tick = follower.tick(walker, seen(t, ORIGIN));
      assertThat(tick.moves()).isEmpty();
      walker = tick.walker();
      assertThat(walker.phase()).isEqualTo(new Phase.Planning(SHOP.position(), t, 0));
    }
    var gaveUp = follower.tick(walker, seen(MOVEMENT.pathAttempts(), ORIGIN));
    assertThat(gaveUp.moves())
        .containsExactly(
            new Move.ReleaseNavigator(),
            new Move.Teleport(SHOP.position(), new Rotation(0, 0)),
            new Move.Settle(SHOP.rotation(), NpcPose.STANDING));
    assertThat(gaveUp.walker().moving()).isFalse();
  }

  @Test
  void anEmptyPathCountsAsNoPath() {
    var start =
        follower.start(new Intent.Stand(SHOP, NpcPose.STANDING), new At(ORIGIN, Rotation.SOUTH), 0);
    var tick = follower.tick(start.walker(), seen(1, ORIGIN, new Path(List.of(), false)));
    assertThat(tick.walker().phase()).isEqualTo(new Phase.Planning(SHOP.position(), 1, 0));
  }

  @Test
  void teleportsWhenTheEntityStopsMoving() {
    var start =
        follower.start(new Intent.Stand(SHOP, NpcPose.STANDING), new At(ORIGIN, Rotation.SOUTH), 0);
    var following =
        follower.tick(start.walker(), seen(1, ORIGIN, straight(ORIGIN, SHOP.position(), true)));
    assertThat(following.walker().phase()).isInstanceOf(Phase.Following.class);
    // The adapter keeps reporting the old position: the step never happened.
    var walker = following.walker();
    for (var t = 2; t < 1 + MOVEMENT.stuckTicks(); t++) {
      var tick = follower.tick(walker, seen(t, ORIGIN));
      assertThat(tick.moves()).singleElement().isInstanceOf(Move.Step.class);
      walker = tick.walker();
    }
    var stuck = follower.tick(walker, seen(1 + MOVEMENT.stuckTicks(), ORIGIN));
    assertThat(stuck.moves())
        .first()
        .isEqualTo(new Move.Teleport(SHOP.position(), new Rotation(0, 0)));
    assertThat(stuck.walker().phase()).isEqualTo(new Phase.Resting(Long.MAX_VALUE));
  }

  @Test
  void aShortPathIsExtendedByReplanning() {
    var far = spot(0.5, 64, 10.5);
    var start =
        follower.start(new Intent.Stand(far, NpcPose.STANDING), new At(ORIGIN, Rotation.SOUTH), 0);
    // Each path gets 4 blocks closer, like a navigator with a short follow range.
    var sim =
        new Sim(
            follower,
            start.walker(),
            ORIGIN,
            from -> {
              var end = from.towards(far.position(), 4);
              return Optional.of(straight(from, end, end.equals(far.position())));
            });
    sim.runUntilResting(200);
    assertThat(sim.position).isEqualTo(far.position());
    assertThat(sim.moves).noneMatch(Move.Teleport.class::isInstance);
    assertThat(sim.moves).filteredOn(Move.ReleaseNavigator.class::isInstance).hasSize(3);
  }

  @Test
  void givesUpAfterTooManyShortPaths() {
    var far = spot(0.5, 64, 40.5);
    var start =
        follower.start(new Intent.Stand(far, NpcPose.STANDING), new At(ORIGIN, Rotation.SOUTH), 0);
    var sim =
        new Sim(
            follower,
            start.walker(),
            ORIGIN,
            from -> Optional.of(straight(from, from.towards(far.position(), 2), false)));
    sim.runUntilResting(200);
    // One path plus maxReplans more, 2 blocks each, then a teleport the rest of the way.
    assertThat(sim.moves)
        .filteredOn(Move.ReleaseNavigator.class::isInstance)
        .hasSize(1 + MOVEMENT.maxReplans());
    assertThat(sim.moves).filteredOn(Move.Teleport.class::isInstance).hasSize(1);
    assertThat(sim.position).isEqualTo(far.position());
  }

  @Test
  void wanderingPicksPointsInsideTheRadiusAndPausesBetweenLegs() {
    var center = spot(100.5, 64, 100.5);
    var intent = new Intent.Wander(center, 6);
    var start = follower.start(intent, new At(ORIGIN, Rotation.SOUTH), 0);
    var sim =
        new Sim(
            follower,
            start.walker(),
            ORIGIN,
            from -> Optional.of(straight(from, targetOf(start.walker()), true)));
    var targets = new ArrayList<Vec3>();
    for (var leg = 0; leg < 5; leg++) {
      var target = sim.walker.pathTarget().orElseThrow();
      targets.add(target);
      assertThat(target.horizontalDistance(center.position())).isLessThanOrEqualTo(6);
      assertThat(target.y()).isEqualTo(center.position().y());
      var walking =
          new Sim(
              follower,
              sim.walker,
              sim.position,
              from -> Optional.of(straight(from, target, true)));
      walking.tick = sim.tick;
      walking.runUntilResting(1000);
      var resting = (Phase.Resting) walking.walker.phase();
      assertThat(resting.until() - walking.tick)
          .isBetween((long) MOVEMENT.dwellMinTicks(), (long) MOVEMENT.dwellMaxTicks());
      // Rest out the pause, then the next leg starts.
      sim = new Sim(follower, walking.walker, walking.position, from -> Optional.empty());
      sim.tick = resting.until() - 1;
      sim.step();
      assertThat(sim.walker.moving()).isTrue();
    }
    assertThat(targets).doesNotHaveDuplicates();
  }

  private static Vec3 targetOf(Walker walker) {
    return walker.pathTarget().orElseThrow();
  }

  @Test
  void aWanderPointWithNoPathIsSkippedNotTeleportedTo() {
    var center = spot(100.5, 64, 100.5);
    var start = follower.start(new Intent.Wander(center, 6), new At(ORIGIN, Rotation.SOUTH), 0);
    var sim = new Sim(follower, start.walker(), ORIGIN, from -> Optional.empty());
    sim.runUntilResting(50);
    assertThat(sim.moves).noneMatch(Move.Teleport.class::isInstance);
    assertThat(sim.position).isEqualTo(ORIGIN);
  }

  @Test
  void patrolsVisitStopsInOrderAndLoop() {
    var a = spot(0.5, 64, 2.5);
    var b = spot(2.5, 64, 2.5);
    var c = spot(2.5, 64, 0.5);
    var intent = new Intent.Patrol(List.of(a, b, c));
    var start = follower.start(intent, new At(ORIGIN, Rotation.SOUTH), 0);
    var walker = start.walker();
    var position = ORIGIN;
    var tick = 0L;
    var visited = new ArrayList<Integer>();
    for (var leg = 0; leg < 4; leg++) {
      var target = walker.pathTarget().orElseThrow();
      var sim =
          new Sim(follower, walker, position, from -> Optional.of(straight(from, target, true)));
      sim.tick = tick;
      sim.runUntilResting(200);
      visited.add(sim.walker.stop());
      var rest = (Phase.Resting) sim.walker.phase();
      var next = new Sim(follower, sim.walker, sim.position, from -> Optional.empty());
      next.tick = rest.until() - 1;
      next.step();
      walker = next.walker;
      position = next.position;
      tick = next.tick;
    }
    assertThat(visited).containsExactly(0, 1, 2, 0);
  }

  @Test
  void aRestingNpcLooksAtANearbyPlayerThenBack() {
    var start =
        follower.start(
            new Intent.Stand(SHOP, NpcPose.STANDING), new At(SHOP.position(), SHOP.rotation()), 0);
    var eyes = SHOP.position().plus(new Vec3(3, 1.62, 0));
    var looking =
        follower.tick(
            start.walker(),
            new Observation(
                1, SHOP.position(), SHOP.rotation(), Optional.empty(), Optional.of(eyes)));
    var face = (Move.Face) looking.moves().getFirst();
    assertThat(face.facing().yaw()).isCloseTo(-90f, within(1.0e-3f));
    assertThat(face.facing().pitch()).isCloseTo(0f, within(1.0e-3f));
    // Already facing them: nothing to send.
    var still =
        follower.tick(
            start.walker(),
            new Observation(
                2, SHOP.position(), face.facing(), Optional.empty(), Optional.of(eyes)));
    assertThat(still.moves()).isEmpty();
    // They left: turn back to the place's facing.
    var back =
        follower.tick(
            start.walker(),
            new Observation(
                3, SHOP.position(), new Rotation(10, 0), Optional.empty(), Optional.empty()));
    assertThat(back.moves()).containsExactly(new Move.Face(SHOP.rotation()));
  }

  @Test
  void aSleepingNpcDoesNotLookAround() {
    var bed = spot(0.5, 64, 0.5, 180);
    var start = follower.start(new Intent.Sleep(bed), new At(bed.position(), Rotation.SOUTH), 0);
    assertThat(start.moves()).containsExactly(new Move.Settle(bed.rotation(), NpcPose.SLEEPING));
    var tick =
        follower.tick(
            start.walker(),
            new Observation(
                1,
                bed.position(),
                Rotation.SOUTH,
                Optional.empty(),
                Optional.of(new Vec3(3, 65, 3))));
    assertThat(tick.moves()).isEmpty();
  }

  @Test
  void retargetingToTheSameIntentChangesNothing() {
    var intent = new Intent.Stand(SHOP, NpcPose.STANDING);
    var start = follower.start(intent, new At(ORIGIN, Rotation.SOUTH), 0);
    var same = follower.retarget(start.walker(), intent, new At(ORIGIN, Rotation.SOUTH), 5);
    assertThat(same.walker()).isSameAs(start.walker());
    assertThat(same.moves()).isEmpty();
  }

  @Test
  void retargetingMidPlanReleasesTheNavigator() {
    var start =
        follower.start(new Intent.Stand(SHOP, NpcPose.STANDING), new At(ORIGIN, Rotation.SOUTH), 0);
    var bed = spot(-4.5, 64, 0.5);
    var changed =
        follower.retarget(start.walker(), new Intent.Sleep(bed), new At(ORIGIN, Rotation.SOUTH), 5);
    assertThat(changed.moves())
        .containsExactly(
            new Move.ReleaseNavigator(), new Move.Settle(Rotation.SOUTH, NpcPose.STANDING));
    assertThat(changed.walker().pathTarget()).contains(bed.position());
  }

  @Test
  void settingsRejectSlidingSpeeds() {
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> new MovementSettings(0.3, 0.3, 1, 1, 0, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> new MovementSettings(0.2, 0.1, 1, 1, 0, 0, 0))
        .isInstanceOf(IllegalArgumentException.class);
    org.assertj.core.api.Assertions.assertThatThrownBy(
            () -> new MovementSettings(0.2, 0.3, 1, 1, 0, 5, 4))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
