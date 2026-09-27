package com.shepherdjerred.thestorm.agent.app;

import static com.shepherdjerred.thestorm.agent.app.AgentFixtures.ALICE;
import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

final class FaqMemoryTest {

  private static final Instant NOW = Instant.parse("2017-06-01T12:00:00Z");
  private static final Duration HALF_LIFE = Duration.ofDays(7);

  @Test
  void hitsCountPerPlayerPerEntry() {
    var memory = new FaqMemory();
    memory.recordHit(ALICE, "kit", NOW, HALF_LIFE);
    memory.recordHit(ALICE, "kit", NOW.plusSeconds(30), HALF_LIFE);

    assertThat(memory.strikes(ALICE, "kit", NOW.plusSeconds(60), HALF_LIFE)).isEqualTo(2);
    assertThat(memory.strikes(ALICE, "rules", NOW, HALF_LIFE)).isZero();
  }

  @Test
  void hitsAreForgottenAfterOneHalfLife() {
    var memory = new FaqMemory();
    memory.recordHit(ALICE, "kit", NOW, HALF_LIFE);

    assertThat(memory.strikes(ALICE, "kit", NOW.plus(HALF_LIFE).minusSeconds(1), HALF_LIFE))
        .isEqualTo(1);
    assertThat(memory.strikes(ALICE, "kit", NOW.plus(HALF_LIFE), HALF_LIFE)).isZero();
    assertThat(memory.strikes(ALICE, "kit", NOW.plus(HALF_LIFE.multipliedBy(2)), HALF_LIFE))
        .isZero();
  }

  @Test
  void ancientHitsArePruned() {
    var memory = new FaqMemory();
    memory.recordHit(ALICE, "kit", NOW, HALF_LIFE);

    var ancient = NOW.plus(HALF_LIFE.multipliedBy(11));
    memory.recordHit(ALICE, "kit", ancient, HALF_LIFE);

    assertThat(memory.strikes(ALICE, "kit", ancient, HALF_LIFE)).isEqualTo(1);
  }
}
