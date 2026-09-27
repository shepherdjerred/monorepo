package com.shepherdjerred.thestorm.tracks.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.concurrent.atomic.AtomicInteger;
import org.junit.jupiter.api.Test;

final class TrackGroupDeclarationsTest {

  private final TestRuntime test = new TestRuntime();
  private final AtomicInteger reconciled = new AtomicInteger();
  private final TrackGroupDeclarations groups =
      new TrackGroupDeclarations(
          test.permissions, test.scheduler, test.runtime.logger(), reconciled::incrementAndGet);

  @Test
  void failedDeclarationsKeepPurchasesClosedUntilAFullRetrySucceeds() {
    test.permissions.failNextDeclarations(2);

    groups.start();
    assertThat(groups.ready()).isFalse();
    assertThat(test.scheduler.pendingDelays()).containsExactly(Duration.ofSeconds(1));
    test.scheduler.runDelayed();
    assertThat(groups.ready()).isFalse();
    assertThat(test.scheduler.pendingDelays()).containsExactly(Duration.ofSeconds(2));
    test.scheduler.runDelayed();

    assertThat(groups.ready()).isTrue();
    assertThat(test.permissions.declared()).isEqualTo(3);
    assertThat(reconciled).hasValue(1);
  }

  @Test
  void stoppingPreventsADelayedRetryFromReopeningPurchases() {
    test.permissions.failNextDeclarations(1);
    groups.start();
    groups.stop();

    test.scheduler.runDelayed();

    assertThat(groups.ready()).isFalse();
    assertThat(test.permissions.declared()).isEqualTo(1);
    assertThat(reconciled).hasValue(0);
  }
}
