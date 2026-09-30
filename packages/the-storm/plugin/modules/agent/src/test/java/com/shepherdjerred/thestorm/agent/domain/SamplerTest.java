package com.shepherdjerred.thestorm.agent.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Random;
import org.junit.jupiter.api.Test;

final class SamplerTest {

  @Test
  void zeroSamplesNothing() {
    var random = new Random(1);

    for (var i = 0; i < 100; i++) {
      assertThat(Sampler.shouldSample(random, 0)).isFalse();
    }
  }

  @Test
  void oneHundredSamplesEverything() {
    var random = new Random(1);

    for (var i = 0; i < 100; i++) {
      assertThat(Sampler.shouldSample(random, 100)).isTrue();
    }
  }

  @Test
  void midRatesSampleAboutThatShare() {
    var sampled = 0;
    var random = new Random(7);
    for (var i = 0; i < 1000; i++) {
      if (Sampler.shouldSample(random, 10)) {
        sampled++;
      }
    }

    assertThat(sampled).isBetween(50, 150);
  }

  @Test
  void edgesClampWithoutTouchingTheGenerator() {
    var random = new Random(1);
    random.nextLong();

    assertThat(Sampler.shouldSample(random, -5)).isFalse();
    assertThat(Sampler.shouldSample(random, 500)).isTrue();

    // The edges short-circuit: the stream sits exactly past the probe.
    var replay = new Random(1);
    replay.nextLong();
    assertThat(random.nextLong()).isEqualTo(replay.nextLong());
  }
}
