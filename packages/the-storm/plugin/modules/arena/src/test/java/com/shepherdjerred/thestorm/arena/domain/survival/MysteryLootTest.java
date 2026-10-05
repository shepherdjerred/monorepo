package com.shepherdjerred.thestorm.arena.domain.survival;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.EnumMap;
import org.junit.jupiter.api.Test;

final class MysteryLootTest {
  @Test
  void rewardPoolsHaveExactlyTheAuthoredOddsWithoutGapsOrOverlaps() {
    var counts = new EnumMap<GearRarity, Integer>(GearRarity.class);
    for (var roll = 0; roll < 100; roll++) counts.merge(MysteryLoot.rarity(roll), 1, Integer::sum);
    assertThat(counts)
        .containsEntry(GearRarity.COMMON, 25)
        .containsEntry(GearRarity.UNCOMMON, 30)
        .containsEntry(GearRarity.EPIC, 25)
        .containsEntry(GearRarity.LEGENDARY, 16)
        .containsEntry(GearRarity.MYTHIC, 4)
        .hasSize(5);
    assertThatThrownBy(() -> MysteryLoot.rarity(-1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> MysteryLoot.rarity(100)).isInstanceOf(IllegalArgumentException.class);
  }
}
