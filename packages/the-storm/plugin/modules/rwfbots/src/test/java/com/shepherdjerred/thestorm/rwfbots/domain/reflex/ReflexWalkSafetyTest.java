package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.GridBounds;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
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
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.BitSet;
import java.util.List;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class ReflexWalkSafetyTest {
  private static final Vec3 BASE = new Vec3(8.5, 1, 1.5);

  @Test
  void teammateRepulsionCannotBendACertifiedCorridorIntoTheAdjacentWall() {
    var fixture = fixture(true, 1);
    assertThat(
            CombatFootwork.safe(fixture.grid(), fixture.self(), BASE.minus(fixture.self().pos())))
        .isTrue();
    var move = move(fixture, new Waypoint(BASE, Hop.WALK));
    assertThat(move.waypoint()).isEqualTo(BASE);
    assertThat(
            CombatFootwork.safe(
                fixture.grid(), fixture.self(), move.waypoint().minus(fixture.self().pos())))
        .isTrue();
  }

  @Test
  void openSpaceStillPermitsSafeSeparationInsteadOfFlatteningTheFormation() {
    var fixture = fixture(false, 1);
    var move = move(fixture, new Waypoint(BASE, Hop.WALK));
    assertThat(move.waypoint()).isNotEqualTo(BASE);
    assertThat(
            CombatFootwork.safe(
                fixture.grid(), fixture.self(), move.waypoint().minus(fixture.self().pos())))
        .isTrue();
  }

  @Test
  void aCertifiedPartialSlabBaseRemainsUsableBesideTheWall() {
    var fixture = fixture(true, 0.5);
    var base = new Vec3(BASE.x(), 0.5, BASE.z());
    assertThat(
            CombatFootwork.safe(fixture.grid(), fixture.self(), base.minus(fixture.self().pos())))
        .isTrue();
    assertThat(move(fixture, new Waypoint(base, Hop.WALK)).waypoint()).isEqualTo(base);
  }

  @Test
  void specializedGroundDropClimbSwimAndLeapKeepTheirOwnControllers() {
    var fixture = fixture(true, 1);
    for (var hop : List.of(Hop.DROP, Hop.CLIMB, Hop.SWIM))
      assertThat(move(fixture, new Waypoint(BASE, hop)).waypoint()).isEqualTo(BASE);
    var launch = new JumpLaunch(new Vec3(4.7, 1, 1.5), new Vec3(2.7, 1, 1.5), 0.27, 13);
    assertThat(move(fixture, new Waypoint(BASE, Hop.LEAP, Optional.of(launch))).waypoint())
        .isEqualTo(launch.runUpStart());
  }

  @Test
  void yieldingCannotPushTheBodyIntoAWallButStillMakesRoomInOpenSpace() {
    for (var wall : List.of(true, false)) {
      var original = fixture(wall, 1);
      var fixture =
          new Fixture(
              original.grid(),
              original.self(),
              original
                  .ally()
                  .withPos(original.self().pos().plus(0.5, 0, 0.39))
                  .withVel(new Vec3(0.2, 0, 0)));
      var step = tick(fixture, new Waypoint(BASE, Hop.WALK));
      if (wall) {
        assertThat(step.commands()).contains(new BodyCommand.Stop());
        assertThat(step.commands()).noneMatch(BodyCommand.MoveToward.class::isInstance);
      } else {
        assertThat(step.commands()).anyMatch(BodyCommand.MoveToward.class::isInstance);
      }
    }
  }

  private record Fixture(VoxelGrid grid, CombatantView self, CombatantView ally) {}

  private static Fixture fixture(boolean wall, double feetY) {
    var bounds = new GridBounds(new BlockPos(0, 0, -8), 16, 4, 16);
    var solid = new BitSet(bounds.volume());
    for (var x = 0; x < 16; x++) for (var z = -8; z < 8; z++) solid.set(bounds.index(x, 0, z));
    if (wall)
      for (var x = 0; x < 16; x++) for (var y = 1; y <= 2; y++) solid.set(bounds.index(x, y, 0));
    return new Fixture(
        new VoxelGrid(bounds, solid, solid, solid),
        combatant(1, RED, new Vec3(2.5, feetY, 1.31)),
        combatant(2, RED, new Vec3(2.5, feetY, 1.9)));
  }

  private static BodyCommand.MoveToward move(Fixture fixture, Waypoint first) {
    return tick(fixture, first).commands().stream()
        .filter(BodyCommand.MoveToward.class::isInstance)
        .map(BodyCommand.MoveToward.class::cast)
        .findFirst()
        .orElseThrow();
  }

  private static Reflex.Step tick(Fixture fixture, Waypoint first) {
    var points =
        List.of(
            first,
            new Waypoint(first.pos().plus(1, 0, 0), Hop.WALK),
            new Waypoint(first.pos().plus(2, 0, 0), Hop.WALK),
            new Waypoint(first.pos().plus(3, 0, 0), Hop.WALK));
    var decision =
        new Decision(
            fixture.self().id(),
            Option.HUNT,
            Optional.empty(),
            points,
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "corridor",
            10,
            1);
    var world =
        new WorldSnapshot(
            10,
            MatchPhase.LIVE,
            List.of(fixture.self(), fixture.ally()),
            List.of(),
            PoisonView.NONE,
            "corridor",
            List.of());
    return Reflex.tick(
        ReflexState.initial(fixture.self().facing()),
        new ReflexInput(fixture.self(), world, decision, Optional.empty(), 0),
        new ReflexContext(fixture.grid(), levers(1), Loadout.standard(Kit.TROOPER)),
        new SplittableRandom(196));
  }
}
