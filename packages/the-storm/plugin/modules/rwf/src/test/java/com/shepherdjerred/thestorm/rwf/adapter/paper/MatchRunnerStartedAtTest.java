package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;

final class MatchRunnerStartedAtTest {

  private static final Instant ENDED = Instant.parse("2026-10-04T07:06:23Z");

  @Test
  void usesTheLiveInstantWhenItPrecedesTheEnd() {
    var live = ENDED.minus(Duration.ofMinutes(3));
    assertThat(MatchRunner.startedAtFor(live, ENDED)).isEqualTo(live);
  }

  @Test
  void fallsBackToTheEndWhenTheMatchNeverWentLive() {
    assertThat(MatchRunner.startedAtFor(null, ENDED)).isEqualTo(ENDED);
  }

  @Test
  void neverStartsAfterItEnds() {
    // A start decided in the same step as the end can carry a later clock read.
    var live = ENDED.plus(Duration.ofMillis(3));
    assertThat(MatchRunner.startedAtFor(live, ENDED)).isEqualTo(ENDED);
  }
}
