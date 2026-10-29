package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.BodyCommand;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** When a Tactician sounds its horn. */
final class RallyHornTest {

  private static final Vec3 HERE = new Vec3(5.5, 1, 5.5);
  private static final Loadout.KitItem HORN = KitScene.item(Kit.TACTICIAN);
  private static final BodyCommand.UseKit SOUND =
      new BodyCommand.UseKit(HORN.slot(), Optional.empty(), Optional.empty());

  /** Two teammates at its side and an enemy coming into view down the field. */
  private static final KitScene BEFORE_A_FIGHT =
      KitScene.of(Kit.TACTICIAN, RED, HERE)
          .with(
              combatant(2, RED, HERE.plus(3, 0, 0)),
              combatant(3, RED, HERE.plus(0, 0, 4)),
              combatant(9, BLUE, HERE.plus(24, 0, 0)));

  private static Optional<BodyCommand.UseKit> horn(KitScene scene) {
    return KitPlay.choose(HORN, scene.input(), 0, Optional.empty());
  }

  @Test
  void theHornIsTheTacticiansItemAndRechargesWithTheBuff() {
    assertThat(HORN.move().item()).isEqualTo("GOAT_HORN");
    assertThat(HORN.move().gapTicks()).isEqualTo(800);
  }

  @Test
  void aTacticianSoundsTheHornBeforeAFightWithTwoTeammatesBesideIt() {
    assertThat(horn(BEFORE_A_FIGHT)).contains(SOUND);
  }

  @Test
  void theHornWantsTwoTeammatesInsideItsReach() {
    var one =
        KitScene.of(Kit.TACTICIAN, RED, HERE)
            .with(combatant(2, RED, HERE.plus(3, 0, 0)), combatant(9, BLUE, HERE.plus(24, 0, 0)));
    var straggler = one.with(combatant(3, RED, HERE.plus(9, 0, 0)));

    assertThat(horn(one)).isEmpty();
    assertThat(horn(straggler)).isEmpty();
  }

  @Test
  void theHornWaitsForAFightToBeComing() {
    var quiet =
        KitScene.of(Kit.TACTICIAN, RED, HERE)
            .with(combatant(2, RED, HERE.plus(3, 0, 0)), combatant(3, RED, HERE.plus(0, 0, 4)));

    assertThat(horn(quiet)).isEmpty();
    assertThat(horn(quiet.doing(Option.RETAKE, Stance.AGGRESSIVE))).contains(SOUND);
    assertThat(horn(quiet.doing(Option.HELP_ARM, Stance.AGGRESSIVE))).contains(SOUND);
  }

  @Test
  void aWalkingTacticianStillSoundsItTheBodyStopsFirst() {
    assertThat(horn(BEFORE_A_FIGHT.self(BEFORE_A_FIGHT.self().withVel(new Vec3(0.2, 0, 0)))))
        .contains(SOUND);
  }

  @Test
  void theHornIsNeverStartedWhereTheWindupWouldBreak() {
    assertThat(horn(BEFORE_A_FIGHT.self(BEFORE_A_FIGHT.self().withMotion(false, false))))
        .as("in the air")
        .isEmpty();
    assertThat(horn(BEFORE_A_FIGHT.self(BEFORE_A_FIGHT.self().withLastHurtTick(90))))
        .as("just hurt")
        .isEmpty();
    assertThat(horn(BEFORE_A_FIGHT.with(combatant(8, BLUE, HERE.plus(6, 0, 0)))))
        .as("an enemy close enough to hit it during the windup")
        .isEmpty();
  }
}
