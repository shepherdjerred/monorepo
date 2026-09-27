package com.shepherdjerred.thestorm.quests.domain.engine;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Set;
import org.junit.jupiter.api.Test;

final class KillCreditTest {

  @Test
  void naturalCreaturesCountButFarmedAndScriptedOnesDoNot() {
    assertThat(KillCredit.eligible("NATURAL", Set.of())).isTrue();
    assertThat(KillCredit.eligible("RAID", Set.of())).isTrue();
    for (var reason :
        Set.of("SPAWNER", "TRIAL_SPAWNER", "SPAWNER_EGG", "DISPENSE_EGG", "COMMAND", "CUSTOM")) {
      assertThat(KillCredit.eligible(reason, Set.of())).as(reason).isFalse();
    }
    assertThat(KillCredit.eligible("NATURAL", Set.of(KillCredit.QUEST_SPAWNED))).isFalse();
    assertThat(KillCredit.eligible("NATURAL", Set.of(KillCredit.ARENA_ENTITY))).isFalse();
  }
}
