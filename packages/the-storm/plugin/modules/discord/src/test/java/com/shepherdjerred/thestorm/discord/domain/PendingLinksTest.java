package com.shepherdjerred.thestorm.discord.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class PendingLinksTest {

  private static final Instant T0 = Instant.parse("2026-10-11T12:00:00Z");

  private final PendingLinks pending = new PendingLinks(Duration.ofMinutes(10));
  private final SplittableRandom random = new SplittableRandom(7);

  @Test
  void aCodeLinksItsDiscordUserOnceWhileLive() {
    var code = pending.start(42L, T0, random);

    assertThat(code).hasSize(PendingLinks.LENGTH).matches("[" + PendingLinks.ALPHABET + "]+");
    assertThat(pending.redeem(code.toLowerCase(java.util.Locale.ROOT), T0.plusSeconds(60)))
        .contains(42L);
    assertThat(pending.redeem(code, T0.plusSeconds(61))).as("used up").isEmpty();
  }

  @Test
  void codesExpireAndANewCodeReplacesTheOld() {
    var first = pending.start(42L, T0, random);
    var second = pending.start(42L, T0, random);
    var other = pending.start(7L, T0, random);

    assertThat(pending.redeem(first, T0)).isEmpty();
    assertThat(pending.redeem(other, T0.plus(Duration.ofMinutes(10)))).isEmpty();
    assertThat(pending.redeem(second, T0.plus(Duration.ofMinutes(9)))).contains(42L);
  }
}
