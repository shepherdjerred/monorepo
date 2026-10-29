package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.BlockPos;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap;
import com.shepherdjerred.thestorm.rwfbots.domain.map.VoxelGrid;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** When a Windrunner or a Maceguard throws a wind charge, and that its own flight is safe. */
final class WindChargeTest {

  private static final VoxelGrid GRID = SyntheticMap.bake().grid();
  private static final Vec3 HERE = new Vec3(10.5, 1, 10.5);
  private static final Loadout.KitItem WIND = KitScene.item(Kit.WINDRUNNER);

  private static Optional<Vec3> gust(KitScene scene, VoxelGrid grid) {
    return KitPlay.choose(WIND, scene.input(), 0, Optional.of(grid))
        .map(use -> use.at().orElseThrow());
  }

  private static KitScene facing(Kit kit, Vec3 enemyAt) {
    return KitScene.of(kit, RED, HERE)
        .doing(Option.ENGAGE, Stance.AGGRESSIVE)
        .fighting(combatant(9, BLUE, enemyAt));
  }

  @Test
  void bothWindKitsCarryTheSameCharge() {
    assertThat(KitScene.item(Kit.MACEGUARD).move()).isEqualTo(WIND.move());
    assertThat(WIND.move().item()).isEqualTo("WIND_CHARGE");
  }

  @Test
  void aWindrunnerShovesASwordsmanBackOutToBowRange() {
    var enemy = HERE.plus(2, 0, 0);

    assertThat(gust(facing(Kit.WINDRUNNER, enemy), GRID))
        .contains(enemy.plus(0, WindCharge.BODY, 0));
    assertThat(gust(facing(Kit.WINDRUNNER, HERE.plus(9, 0, 0)), GRID))
        .as("an archer keeps its distance on its own")
        .isEmpty();
  }

  @Test
  void aMaceguardLaunchesStraightUpOverAnEnemyAtHand() {
    assertThat(gust(facing(Kit.MACEGUARD, HERE.plus(2, 0, 0)), GRID))
        .contains(HERE.plus(0, -0.1, 0));
  }

  @Test
  void aMaceguardLeapsAtAnEnemyARunAwayOverWholeGround() {
    var from = new Vec3(10.5, 1, 4.5);
    var scene =
        KitScene.of(Kit.MACEGUARD, RED, from)
            .doing(Option.ENGAGE, Stance.AGGRESSIVE)
            .fighting(combatant(9, BLUE, from.plus(0, 0, 9)));

    assertThat(gust(scene, GRID))
        .as("a burst just behind its feet flings it forward")
        .contains(from.plus(0, -0.1, -WindCharge.BURST_OFFSET));
    assertThat(
            gust(
                scene,
                PearlThrowTest.withoutFloor(GRID, new BlockPos(9, 0, 9), new BlockPos(11, 0, 10))))
        .as("a pit on the way")
        .isEmpty();
  }

  @Test
  void eitherKitKnocksAnEnemyStandingByADropOverIt() {
    var cliff = PearlThrowTest.withoutFloor(GRID, new BlockPos(14, 0, 0), new BlockPos(31, 0, 31));
    var enemy = HERE.plus(2, 0, 0);

    assertThat(gust(facing(Kit.MACEGUARD, enemy), cliff))
        .contains(enemy.plus(0, WindCharge.BODY, 0));
    assertThat(WindCharge.ledgeBehind(cliff, enemy, new Vec3(1, 0, 0))).isTrue();
    assertThat(WindCharge.ledgeBehind(GRID, enemy, new Vec3(1, 0, 0))).isFalse();
  }

  @Test
  void aHurtBotBurstsTheChargeOnTheEnemysSideAndFliesOff() {
    var enemy = HERE.plus(2, 0, 0);
    var hurt = facing(Kit.WINDRUNNER, enemy).health(6);

    assertThat(gust(hurt, GRID)).contains(HERE.plus(WindCharge.BURST_OFFSET, -0.1, 0));
    assertThat(
            gust(
                hurt,
                PearlThrowTest.withoutFloor(GRID, new BlockPos(0, 0, 0), new BlockPos(7, 0, 31))))
        .as("its flight would come down in the void")
        .isEmpty();
  }

  @Test
  void aChargeIsOnlyThrownStandingOnTheGround() {
    var scene = facing(Kit.WINDRUNNER, HERE.plus(2, 0, 0));

    assertThat(gust(scene.self(scene.self().withMotion(false, false)), GRID)).isEmpty();
    assertThat(KitPlay.choose(WIND, scene.input(), 0, Optional.empty()))
        .as("no map to check the flight against")
        .isEmpty();
  }

  @Test
  void aBotUnderARoofDoesNotLaunch() {
    var roofed = withRoof(GRID, new BlockPos(8, 3, 8), new BlockPos(13, 3, 13));

    assertThat(gust(facing(Kit.MACEGUARD, HERE.plus(2, 0, 0)), roofed)).isEmpty();
    assertThat(gust(facing(Kit.WINDRUNNER, HERE.plus(2, 0, 0)).health(6), roofed)).isEmpty();
  }

  private static VoxelGrid withRoof(VoxelGrid grid, BlockPos from, BlockPos to) {
    var y = from.y();
    var movement = (java.util.BitSet) grid.movement().clone();
    var projectile = (java.util.BitSet) grid.projectile().clone();
    var sight = (java.util.BitSet) grid.sight().clone();
    for (var x = from.x(); x <= to.x(); x++) {
      for (var z = from.z(); z <= to.z(); z++) {
        var index = grid.bounds().index(x, y, z);
        movement.set(index);
        projectile.set(index);
        sight.set(index);
      }
    }
    return new VoxelGrid(grid.bounds(), movement, sight, projectile);
  }

  @Test
  void theUseIsAimedThroughTheKitItemsSlot() {
    var use =
        KitPlay.choose(
                WIND, facing(Kit.WINDRUNNER, HERE.plus(2, 0, 0)).input(), 0, Optional.of(GRID))
            .orElseThrow();
    assertThat(use)
        .isEqualTo(
            new BodyCommand.UseKit(
                WIND.slot(), Optional.empty(), Optional.of(HERE.plus(2, WindCharge.BODY, 0))));
  }
}
