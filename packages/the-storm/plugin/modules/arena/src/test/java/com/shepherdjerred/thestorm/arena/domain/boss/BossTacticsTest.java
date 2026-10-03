package com.shepherdjerred.thestorm.arena.domain.boss;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.arena.domain.wave.AbilitySpec;
import com.shepherdjerred.thestorm.arena.domain.wave.AbilityType;
import java.time.Duration;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class BossTacticsTest {
  @Test
  void addsScaleWithThePartyAndTheFinalPhaseWithoutMultiplyingDamage() {
    var adds =
        new AbilitySpec(
            AbilityType.SUMMON_ADDS, Duration.ofSeconds(20), 0, 0, 2, Optional.of("zombie"));
    assertThat(BossTactics.abilities(List.of(adds), 1, false)).containsExactly(adds);
    var full = BossTactics.abilities(List.of(adds), 4, true).getFirst();
    assertThat(full.count()).isEqualTo(6);
    assertThat(full.cooldown()).isEqualTo(Duration.ofSeconds(15));
    assertThat(full.power()).isZero();
  }

  @Test
  void theHeartObjectiveRequiresMoreHitsButKeepsItsDamageFraction() {
    var heart =
        new AbilitySpec(AbilityType.HEART, Duration.ofSeconds(25), 0, 0.25, 5, Optional.empty());
    var full = BossTactics.abilities(List.of(heart), 4, true).getFirst();
    assertThat(full.count()).isEqualTo(8);
    assertThat(full.power()).isEqualTo(0.25);
    assertThat(full.cooldown()).isEqualTo(heart.cooldown());
  }
}
