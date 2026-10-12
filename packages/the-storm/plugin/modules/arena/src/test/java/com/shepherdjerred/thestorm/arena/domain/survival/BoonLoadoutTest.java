package com.shepherdjerred.thestorm.arena.domain.survival;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Optional;
import org.junit.jupiter.api.Test;

final class BoonLoadoutTest {
  @Test
  void thirdBoonRequiresAnExplicitReplacementAndRetainsPurchases() {
    var loadout = new BoonLoadout();
    loadout.equip(SurvivalPerk.STONEWARD, Optional.empty());
    loadout.equip(SurvivalPerk.SOULBOND, Optional.empty());
    assertThatThrownBy(() -> loadout.equip(SurvivalPerk.EMBERWEAVE, Optional.empty()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(loadout.equipped())
        .containsExactlyInAnyOrder(SurvivalPerk.STONEWARD, SurvivalPerk.SOULBOND);
    loadout.equip(SurvivalPerk.EMBERWEAVE, Optional.of(SurvivalPerk.STONEWARD));
    assertThat(loadout.purchased(SurvivalPerk.STONEWARD)).isTrue();
    assertThat(loadout.has(SurvivalPerk.STONEWARD)).isFalse();
    loadout.equip(SurvivalPerk.STONEWARD, Optional.of(SurvivalPerk.SOULBOND));
    assertThat(loadout.equipped())
        .containsExactlyInAnyOrder(SurvivalPerk.STONEWARD, SurvivalPerk.EMBERWEAVE);
  }

  @Test
  void invalidReplacementCannotChangeTheLoadout() {
    var loadout = new BoonLoadout();
    assertThat(loadout.canEquip(SurvivalPerk.SOULBOND, Optional.of(SurvivalPerk.STONEWARD)))
        .isFalse();
    loadout.equip(SurvivalPerk.SOULBOND, Optional.empty());
    assertThat(loadout.canEquip(SurvivalPerk.SOULBOND, Optional.empty())).isFalse();
  }
}
