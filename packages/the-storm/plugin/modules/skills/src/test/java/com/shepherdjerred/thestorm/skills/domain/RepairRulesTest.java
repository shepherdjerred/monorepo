package com.shepherdjerred.thestorm.skills.domain;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

final class RepairRulesTest {

  @Test
  void higherLevelsRestoreMoreDurability() {
    assertThat(RepairRules.amount(1000, 0)).isEqualTo(250);
    assertThat(RepairRules.amount(1000, 1000)).isEqualTo(500);
  }

  @Test
  void rejectsInvalidInputs() {
    assertThatThrownBy(() -> RepairRules.amount(0, 0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> RepairRules.amount(100, 1001))
        .isInstanceOf(IllegalArgumentException.class);
  }
}
