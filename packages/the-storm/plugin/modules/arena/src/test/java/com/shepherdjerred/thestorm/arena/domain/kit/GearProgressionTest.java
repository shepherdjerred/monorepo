package com.shepherdjerred.thestorm.arena.domain.kit;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class GearProgressionTest {
  @Test
  void aSpecialistWeaponGrowsWithoutLosingItsIdentity() {
    var axe =
        new ItemSpec(
            "DIAMOND_AXE",
            1,
            Optional.of("Berserker"),
            Map.of("sharpness", 3),
            Optional.empty(),
            Optional.empty());
    assertThat(GearProgression.at(axe, 1).material()).isEqualTo("STONE_AXE");
    assertThat(GearProgression.at(axe, 5).enchantments()).containsEntry("sharpness", 1);
    assertThat(GearProgression.at(axe, 6).material()).isEqualTo("IRON_AXE");
    assertThat(GearProgression.at(axe, 15).enchantments()).containsEntry("sharpness", 2);
    assertThat(GearProgression.at(axe, 16)).isEqualTo(axe);
    assertThat(GearProgression.at(axe, 31).enchantments()).containsEntry("sharpness", 4);
    assertThat(GearProgression.at(axe, 72).name()).isEqualTo(axe.name());
  }

  @Test
  void consumablesAndSpecialUtilityNeverBecomeEquipment() {
    var potion =
        new ItemSpec(
            "POTION",
            2,
            Optional.empty(),
            Map.of(),
            Optional.of("strong_healing"),
            Optional.empty());
    assertThat(GearProgression.at(potion, 1)).isEqualTo(potion);
    assertThat(GearProgression.at(potion, 31)).isEqualTo(potion);
    var bow =
        new ItemSpec(
            "BOW",
            1,
            Optional.empty(),
            Map.of("infinity", 1, "power", 3),
            Optional.empty(),
            Optional.empty());
    assertThat(GearProgression.at(bow, 31).enchantments())
        .containsEntry("infinity", 1)
        .containsEntry("power", 4);
  }
}
