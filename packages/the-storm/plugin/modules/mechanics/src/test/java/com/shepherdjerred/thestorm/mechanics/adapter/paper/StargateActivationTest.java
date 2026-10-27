package com.shepherdjerred.thestorm.mechanics.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;

final class StargateActivationTest {
  @Test
  void failedPlacementCancelsCloseAndAttemptsCleanup() {
    var cancelled = new AtomicBoolean();
    var cleaned = new AtomicBoolean();
    var failure = new IllegalStateException("placement failed");

    StargateActivation.abort(() -> cancelled.set(true), () -> cleaned.set(true), failure);

    assertThat(cancelled).isTrue();
    assertThat(cleaned).isTrue();
    assertThat(failure.getSuppressed()).isEmpty();
  }

  @Test
  void cleanupFailureDoesNotHidePlacementFailure() {
    var cleanupFailure = new IllegalStateException("cleanup failed");
    var failure = new IllegalStateException("placement failed");

    StargateActivation.abort(
        () -> {},
        () -> {
          throw cleanupFailure;
        },
        failure);

    assertThat(failure.getSuppressed()).containsExactly(cleanupFailure);
  }
}
