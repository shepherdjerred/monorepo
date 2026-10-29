package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.BitSet;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** When a Ninja or a Ghost throws an ender pearl, and that it only ever lands on safe ground. */
final class PearlThrowTest {

  private static final VoxelGrid GRID = SyntheticMap.bake().grid();
  private static final Vec3 HERE = new Vec3(3.5, 1, 4.5);
  private static final Loadout.KitItem PEARL = KitScene.item(Kit.NINJA);

  /** A path north along the west half, toward the far corner. */
  private static final Waypoint[] NORTH = {
    new Waypoint(new Vec3(3.5, 1, 8.5), Hop.WALK),
    new Waypoint(new Vec3(4.5, 1, 13.5), Hop.WALK),
    new Waypoint(new Vec3(5.5, 1, 18.5), Hop.WALK),
    new Waypoint(new Vec3(6.5, 1, 23.5), Hop.WALK),
    new Waypoint(new Vec3(7.5, 1, 27.5), Hop.WALK)
  };

  private static Optional<BodyCommand.UseKit> pearl(KitScene scene, VoxelGrid grid) {
    return KitPlay.choose(PEARL, scene.input(), 0, Optional.of(grid));
  }

  /** Where the pearl that {@code use} throws comes down, followed through {@code grid}. */
  private static Optional<Vec3> landing(KitScene scene, BodyCommand.UseKit use, VoxelGrid grid) {
    var eye = scene.self().eye();
    return PearlFlight.landing(grid, eye, Facing.looking(eye, use.at().orElseThrow()), Vec3.ZERO);
  }

  @Test
  void ninjasAndGhostsCarryPearls() {
    assertThat(KitScene.item(Kit.GHOST).move()).isEqualTo(PEARL.move());
    assertThat(PEARL.move().item()).isEqualTo("ENDER_PEARL");
  }

  @Test
  void aPearlFollowedThroughOpenAirComesDownWhereItWasAimed() {
    var eye = HERE.plus(0, 1.62, 0);
    for (var target : new Vec3[] {new Vec3(3.5, 1, 14.5), new Vec3(12.5, 1, 26.5)}) {
      var aim = PearlFlight.aim(eye, target).orElseThrow();
      assertThat(PearlFlight.landing(GRID, eye, aim, Vec3.ZERO))
          .get()
          .satisfies(land -> assertThat(land.distance(target)).isLessThan(0.5));
    }
    assertThat(PearlFlight.aim(eye, new Vec3(3.5, 1, 200))).as("out of range").isEmpty();
  }

  @Test
  void aNinjaPearlsOntoItsPathToCloseOnAnArcher() {
    var archer = KitScene.withKit(combatant(9, BLUE, new Vec3(8.5, 1, 29.5)), Kit.LONGBOW);
    var scene =
        KitScene.of(Kit.NINJA, RED, HERE)
            .doing(Option.ENGAGE, Stance.AGGRESSIVE)
            .fighting(archer)
            .path(NORTH);

    var use = pearl(scene, GRID).orElseThrow();
    var land = landing(scene, use, GRID).orElseThrow();

    assertThat(land.distance(archer.pos())).isLessThan(HERE.distance(archer.pos()) - 6);
    assertThat(java.util.Arrays.stream(NORTH).anyMatch(w -> w.pos().horizontalDistance(land) < 1.5))
        .isTrue();
  }

  @Test
  void inTheOpenANinjaPearlsShortOfTheEnemyWhereTheGroundRunsOnToIt() {
    // A fight in the open has no path: the bot runs straight at the enemy.
    var archer = KitScene.withKit(combatant(9, BLUE, new Vec3(5.5, 1, 26.5)), Kit.LONGBOW);
    var scene =
        KitScene.of(Kit.NINJA, RED, HERE).doing(Option.ENGAGE, Stance.AGGRESSIVE).fighting(archer);

    var use = pearl(scene, GRID).orElseThrow();
    var land = landing(scene, use, GRID).orElseThrow();

    assertThat(land.distance(archer.pos())).isBetween(1.5, 7.5);
    assertThat(
            pearl(
                scene,
                PearlThrowTest.withoutFloor(GRID, new BlockPos(0, 0, 24), new BlockPos(31, 0, 25))))
        .as("a gap between the landing and the enemy")
        .isEmpty();
  }

  @Test
  void aNinjaPearlsAfterARunnerButNotAtAStandingSwordsman() {
    var swordsman = combatant(9, BLUE, new Vec3(5.5, 1, 16.5));
    var runner = swordsman.withVel(new Vec3(0, 0, 0.25));
    var scene =
        KitScene.of(Kit.NINJA, RED, HERE).doing(Option.ENGAGE, Stance.AGGRESSIVE).path(NORTH);

    assertThat(pearl(scene.fighting(runner), GRID)).isPresent();
    assertThat(pearl(scene.fighting(swordsman), GRID)).isEmpty();
    assertThat(pearl(scene.fighting(swordsman.withPos(new Vec3(8.5, 1, 29.5))), GRID))
        .as("a long run away")
        .isPresent();
    assertThat(pearl(scene.fighting(runner.withPos(HERE.plus(0, 0, 4))), GRID))
        .as("already in sword range")
        .isEmpty();
  }

  @Test
  void aHurtGhostPearlsAwayFromTheEnemyAtItsHeels() {
    var chaser = combatant(9, BLUE, HERE.plus(0, 0, -2.5));
    var scene =
        KitScene.of(Kit.GHOST, RED, HERE)
            .doing(Option.RETREAT, Stance.EVASIVE)
            .with(chaser)
            .path(NORTH)
            .health(8);

    var use = pearl(scene, GRID).orElseThrow();
    var land = landing(scene, use, GRID).orElseThrow();

    assertThat(land.distance(chaser.pos())).isGreaterThan(HERE.distance(chaser.pos()) + 6);
    assertThat(pearl(scene.health(6), GRID)).as("the landing would cost too much").isEmpty();
    assertThat(pearl(scene.health(16), GRID)).as("not hurt").isEmpty();
  }

  @Test
  void aPearlIsNeverThrownOntoGroundThatIsNotThere() {
    var archer = KitScene.withKit(combatant(9, BLUE, new Vec3(8.5, 1, 29.5)), Kit.LONGBOW);
    var scene =
        KitScene.of(Kit.NINJA, RED, HERE)
            .doing(Option.ENGAGE, Stance.AGGRESSIVE)
            .fighting(archer)
            .path(NORTH);
    var pit = withoutFloor(GRID, new BlockPos(0, 0, 11), new BlockPos(31, 0, 31));

    assertThat(pearl(scene, pit)).isEmpty();
    assertThat(pearl(scene.self(scene.self().withMotion(false, false)), GRID))
        .as("thrown standing on the ground only")
        .isEmpty();
  }

  @Test
  void aClumsyThrowStillOnlyLeavesTheHandWhenItLandsSafely() {
    var archer = KitScene.withKit(combatant(9, BLUE, new Vec3(8.5, 1, 29.5)), Kit.LONGBOW);
    var scene =
        KitScene.of(Kit.NINJA, RED, HERE)
            .doing(Option.ENGAGE, Stance.AGGRESSIVE)
            .fighting(archer)
            .path(NORTH);
    var clumsy = new KitTiming(1, 6, new SplittableRandom(11));
    var thrown = 0;
    for (var i = 0; i < 200; i++) {
      var use =
          KitPlay.choose(PEARL, scene.input(), 0, new KitPlay.Means(Optional.of(GRID), clumsy));
      if (use.isPresent()) {
        thrown++;
        assertThat(landing(scene, use.orElseThrow(), GRID)).isPresent();
      }
    }
    assertThat(thrown).isPositive();
  }

  /** {@code grid} with the floor (y = 0) gone from the given x and z ranges: the void below. */
  static VoxelGrid withoutFloor(VoxelGrid grid, BlockPos from, BlockPos to) {
    var movement = (BitSet) grid.movement().clone();
    var projectile = (BitSet) grid.projectile().clone();
    var sight = (BitSet) grid.sight().clone();
    for (var x = from.x(); x <= to.x(); x++) {
      for (var z = from.z(); z <= to.z(); z++) {
        var index = grid.bounds().index(x, 0, z);
        movement.clear(index);
        projectile.clear(index);
        sight.clear(index);
      }
    }
    return new VoxelGrid(grid.bounds(), movement, sight, projectile);
  }
}
