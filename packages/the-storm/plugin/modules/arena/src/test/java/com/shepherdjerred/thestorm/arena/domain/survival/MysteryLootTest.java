package com.shepherdjerred.thestorm.arena.domain.survival;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.EnumMap;
import org.junit.jupiter.api.Test;

final class MysteryLootTest {
  @Test
  void rewardPoolsHaveExactlyTheAuthoredOddsWithoutGapsOrOverlaps() {
    var counts = new EnumMap<MysteryLoot.Pool, Integer>(MysteryLoot.Pool.class);
    for (var roll = 0; roll < 100; roll++) counts.merge(MysteryLoot.pool(roll), 1, Integer::sum);
    assertThat(counts)
        .containsEntry(MysteryLoot.Pool.BASIC, 35)
        .containsEntry(MysteryLoot.Pool.ENCHANTED, 40)
        .containsEntry(MysteryLoot.Pool.SPECIAL, 17)
        .containsEntry(MysteryLoot.Pool.LEGENDARY, 8)
        .hasSize(4);
    assertThatThrownBy(() -> MysteryLoot.pool(-1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> MysteryLoot.pool(100)).isInstanceOf(IllegalArgumentException.class);
  }
}
