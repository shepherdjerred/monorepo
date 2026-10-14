package com.shepherdjerred.thestorm.rwfbots.domain.reflex;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.BLUE;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.combatant;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** When a bot calls in a killstreak reward it carries. */
final class StreakPlayTest {

  private static final Vec3 HERE = new Vec3(5.5, 1, 5.5);

  private static ReflexInput input(long tick, Optional<CombatantView> target) {
    return input(tick, target, Option.HOLD_SLOT);
  }

  private static ReflexInput input(long tick, Optional<CombatantView> target, Option option) {
    var self = combatant(1, RED, HERE);
    var world =
        new WorldSnapshot(
            tick,
            MatchPhase.LIVE,
            List.of(self),
            List.of(),
            PoisonView.NONE,
            "synthetic",
            List.of());
    var decision =
        new Decision(
            self.id(),
            option,
            Optional.empty(),
            List.of(),
            Stance.CAUTIOUS,
            Optional.empty(),
            Optional.empty(),
            Optional.empty(),
            "streak test",
            tick,
            0,
            java.util.Optional.empty());
    return new ReflexInput(self, world, decision, target, 0);
  }

  @Test
  void aCarriedRewardIsCalledInWithNobodyInSight() {
    assertThat(StreakPlay.now(1, input(200, Optional.empty()), 0)).isTrue();
  }

  @Test
  void notWhileFightingWithNothingCarriedOrTooSoon() {
    var enemy = combatant(2, BLUE, HERE.plus(4, 0, 0));

    assertThat(StreakPlay.now(1, input(200, Optional.of(enemy)), 0)).isFalse();
    assertThat(StreakPlay.now(0, input(200, Optional.empty()), 0)).isFalse();
    assertThat(StreakPlay.now(1, input(200, Optional.empty()), 250)).isFalse();
    assertThat(StreakPlay.now(1, input(200, Optional.empty(), Option.DEFUSE), 0)).isFalse();
  }
}
