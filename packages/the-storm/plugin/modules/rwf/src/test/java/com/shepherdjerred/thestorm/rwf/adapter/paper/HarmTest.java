package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockbukkit.mockbukkit.MockBukkit;
import org.mockbukkit.mockbukkit.entity.PlayerMock;

/** Rules-dealt damage is taken from absorption first, and only what reaches health is credited. */
final class HarmTest {
  private PlayerMock victim;

  @BeforeEach
  void start() {
    victim = MockBukkit.mock().addPlayer();
    victim.setAbsorptionAmount(4);
  }

  @AfterEach
  void stop() {
    MockBukkit.unmock();
  }

  @Test
  void aHitAbsorptionSoaksReachesNoHealthAndCountsForNothing() {
    assertThat(Harm.toHealth(victim, 3)).isZero();
    Harm.take(victim, 3);
    assertThat(victim.getAbsorptionAmount()).isEqualTo(1);
    assertThat(victim.getHealth()).isEqualTo(20);
  }

  @Test
  void aHitPastAbsorptionTakesTheRestFromHealth() {
    assertThat(Harm.toHealth(victim, 6)).isEqualTo(2);
    Harm.take(victim, 6);
    assertThat(victim.getAbsorptionAmount()).isZero();
    assertThat(victim.getHealth()).isEqualTo(18);
  }
}
