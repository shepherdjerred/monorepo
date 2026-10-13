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
}
