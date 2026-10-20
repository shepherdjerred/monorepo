package com.shepherdjerred.thestorm.rwfbots.domain.tactics;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.EnumMap;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/** The think step's per-kit hook. */
final class KitTacticsTest {

  @Test
  void eachKitLeansTowardWhatItsPowerIsFor() {
    assertThat(KitTactics.leans(Kit.SAPPER)).containsEntry(Option.DEFUSE, KitTactics.LEAN);
    assertThat(KitTactics.leans(Kit.SABOTEUR)).containsEntry(Option.ARM, KitTactics.LEAN);
    assertThat(KitTactics.leans(Kit.DWARF)).containsEntry(Option.HOLD_SLOT, KitTactics.LEAN);
    assertThat(KitTactics.leans(Kit.INERTIA)).containsEntry(Option.ENGAGE, KitTactics.LEAN);
    assertThat(KitTactics.leans(Kit.SACRIFICIAL)).containsEntry(Option.ENGAGE, -KitTactics.LEAN);
    assertThat(KitTactics.leans(Kit.TELEPORTER)).containsEntry(Option.HOLD_SLOT, KitTactics.LEAN);
    assertThat(KitTactics.leans(Kit.GHOST)).containsEntry(Option.HUNT, KitTactics.LEAN);
  }

  @Test
  void thePlainKitsThinkAsBefore() {
    assertThat(KitTactics.leans(Kit.TROOPER)).isEmpty();
    assertThat(KitTactics.leans(Kit.LONGBOW)).isEmpty();
    assertThat(KitTactics.leans(Kit.SHORTBOW)).isEmpty();
  }

  @ParameterizedTest
  @EnumSource(Kit.class)
  void aLeanOnlyMovesOptionsAlreadyScoredAndNeverOverridesAnUrgentMargin(Kit kit) {
    var scores = new EnumMap<Option, Double>(Option.class);
    scores.put(Option.ENGAGE, 1.0);

    KitTactics.lean(kit, scores);

    assertThat(scores).containsOnlyKeys(Option.ENGAGE);
    for (var lean : KitTactics.leans(kit).values()) {
      assertThat(Math.abs(lean)).isLessThan(Tactics.PREEMPT_MARGIN);
    }
  }

  @Test
  void anOptionTheSituationScoredZeroStaysZeroWhateverTheKitLeans() {
    // A spotter with a slot to reach and a ghost with nobody to hunt: their leans used to turn
    // these zeros into standing options that out-lasted the slot route under commitment.
    var spotter = new EnumMap<Option, Double>(Option.class);
    spotter.put(Option.TAKE_SLOT, 0.45);
    spotter.put(Option.HOLD_ANGLE, 0.0);
    KitTactics.lean(Kit.SPOTTER, spotter);
    assertThat(spotter).containsEntry(Option.HOLD_ANGLE, 0.0);

    var ghost = new EnumMap<Option, Double>(Option.class);
    ghost.put(Option.HUNT, 0.0);
    KitTactics.lean(Kit.GHOST, ghost);
    assertThat(ghost).containsEntry(Option.HUNT, 0.0);

    ghost.put(Option.HUNT, 0.3);
    KitTactics.lean(Kit.GHOST, ghost);
    assertThat(ghost.get(Option.HUNT)).isEqualTo(0.3 + KitTactics.LEAN);
  }
}
