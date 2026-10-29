package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.levers;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import java.util.Optional;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

/** When a Smokescreen puts its smoke down. */
final class SmokeCoverTest {

  private static final Vec3 HERE = new Vec3(5.5, 1, 5.5);
  private static final Loadout.KitItem SMOKE = KitScene.item(Kit.SMOKESCREEN);
  private static final BodyCommand.UseKit PUFF =
      new BodyCommand.UseKit(SMOKE.slot(), Optional.empty(), Optional.empty());

  private static Optional<BodyCommand.UseKit> smoke(KitScene scene) {
    return KitPlay.choose(SMOKE, scene.input(), 0, Optional.empty());
  }

  @Test
  void theDyeIsTheSmokescreensItemAndRechargesWithTheSmoke() {
    assertThat(SMOKE.move().item()).isEqualTo("GRAY_DYE");
    assertThat(SMOKE.move().gapTicks()).isEqualTo(600);
  }

  @Test
  void aHurtSmokescreenSmokesWhenAnEnemyCanSeeIt() {
    var enemy = combatant(2, BLUE, HERE.plus(7, 0, 0));
    var scene = KitScene.of(Kit.SMOKESCREEN, RED, HERE).with(enemy);

    assertThat(smoke(scene.health(6))).contains(PUFF);
    assertThat(smoke(scene)).as("healthy and one on one").isEmpty();
    assertThat(smoke(KitScene.of(Kit.SMOKESCREEN, RED, HERE).health(6)))
        .as("nobody in sight")
        .isEmpty();
    assertThat(
            smoke(
                KitScene.of(Kit.SMOKESCREEN, RED, HERE)
                    .health(6)
                    .with(enemy.withPos(HERE.plus(20, 0, 0)))))
        .as("the enemy is too far off to matter")
        .isEmpty();
  }

  @Test
  void aSmokescreenAtABombSmokesWhenAnEnemyWatchesFromBeyondSwordReach() {
    var bomb = KitScene.bombAt(1, BLUE, HERE.plus(1, 0, 0));
    var arming =
        KitScene.of(Kit.SMOKESCREEN, RED, HERE).doing(Option.ARM, Stance.AGGRESSIVE).bomb(bomb);
    var archer = combatant(2, BLUE, HERE.plus(20, 0, 0));
    var swordsman = combatant(3, BLUE, HERE.plus(2, 0, 0));

    assertThat(smoke(arming.with(archer))).contains(PUFF);
    assertThat(smoke(arming.doing(Option.DEFUSE, Stance.AGGRESSIVE).with(archer))).contains(PUFF);
    assertThat(smoke(arming)).as("unwatched").isEmpty();
    assertThat(smoke(arming.with(swordsman))).as("smoke does not stop a sword").isEmpty();
    assertThat(smoke(arming.doing(Option.TAKE_SLOT, Stance.AGGRESSIVE).with(archer)))
        .as("only at fuse work")
        .isEmpty();
    assertThat(smoke(arming.bomb(KitScene.bombAt(1, BLUE, HERE.plus(9, 0, 0))).with(archer)))
        .as("still walking to the bomb")
        .isEmpty();
  }

  @Test
  void anOutnumberedSmokescreenSmokes() {
    var scene =
        KitScene.of(Kit.SMOKESCREEN, RED, HERE)
            .with(combatant(2, BLUE, HERE.plus(6, 0, 0)), combatant(3, BLUE, HERE.plus(-6, 0, 2)));

    assertThat(smoke(scene)).contains(PUFF);
    assertThat(smoke(scene.with(combatant(4, RED, HERE.plus(1, 0, 1)))))
        .as("two on two is even")
        .isEmpty();
  }

  @Test
  void theReflexLayerSmokesWhileDefusingAndWaitsOutTheRecharge() {
    var bomb = KitScene.bombAt(1, RED, HERE.plus(1, 0, 0));
    var scene =
        KitScene.of(Kit.SMOKESCREEN, BLUE, HERE)
            .doing(Option.DEFUSE, Stance.AGGRESSIVE)
            .bomb(bomb)
            .with(combatant(2, RED, HERE.plus(15, 0, 0)));
    var context =
        new ReflexContext(
            com.shepherdjerred.thestorm.rwfbots.domain.map.SyntheticMap.bake().grid(),
            levers(0.9),
            com.shepherdjerred.thestorm.rwfbots.app.Loadouts.rwf(Kit.SMOKESCREEN));
    var state = ReflexState.initial(com.shepherdjerred.thestorm.rwfbots.domain.geom.Facing.SOUTH);
    var random = new SplittableRandom(3);
    var uses = 0;
    var clicks = 0;
    for (var tick = 100; tick < 700; tick++) {
      var at =
          new KitScene(
              scene.self(),
              scene.option(),
              scene.stance(),
              scene.target(),
              scene.others(),
              scene.waypoints(),
              scene.bombs(),
              tick);
      var step = Reflex.tick(state, at.input(), context, random);
      state = step.state();
      uses += (int) step.commands().stream().filter(BodyCommand.UseKit.class::isInstance).count();
      clicks +=
          (int) step.commands().stream().filter(BodyCommand.ClickBomb.class::isInstance).count();
    }

    assertThat(uses).as("one smoke in 30 seconds of defusing").isEqualTo(1);
    assertThat(clicks).as("the defuse goes on").isGreaterThan(50);
  }
}
