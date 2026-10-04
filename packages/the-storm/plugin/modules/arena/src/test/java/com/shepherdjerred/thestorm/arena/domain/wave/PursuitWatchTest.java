package com.shepherdjerred.thestorm.arena.domain.wave;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.arena.domain.geometry.Point;
import java.time.Instant;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;

final class PursuitWatchTest {
  @Test
  void stallsRetryThenRecoverOnceEvenWhenTicksAreLate() {
    var watch = new PursuitWatch();
    var id = UUID.randomUUID();
    var at = new Point(1, 42, 1);
    var now = Instant.EPOCH;
    assertThat(watch.observe(id, at, now, false)).isEqualTo(PursuitWatch.Action.NONE);
    assertThat(watch.observe(id, at, now.plusSeconds(4), false))
        .isEqualTo(PursuitWatch.Action.NONE);
    assertThat(watch.observe(id, at, now.plusSeconds(5), false))
        .isEqualTo(PursuitWatch.Action.RETRY);
    assertThat(watch.observe(id, at, now.plusSeconds(45), false))
        .isEqualTo(PursuitWatch.Action.RELOCATE);
    assertThat(watch.observe(id, at, now.plusSeconds(46), false))
        .isEqualTo(PursuitWatch.Action.NONE);
  }

  @Test
  void attacksMovementAndLifecycleResetStallDetection() {
    var watch = new PursuitWatch();
    var id = UUID.randomUUID();
    var at = new Point(1, 42, 1);
    var now = Instant.EPOCH;
    watch.observe(id, at, now, false);
    assertThat(watch.observe(id, at, now.plusSeconds(30), true))
        .isEqualTo(PursuitWatch.Action.NONE);
    assertThat(watch.observe(id, new Point(2, 42, 1), now.plusSeconds(50), false))
        .isEqualTo(PursuitWatch.Action.NONE);
    watch.retain(Set.of());
    assertThat(watch.observe(id, at, now.plusSeconds(100), false))
        .isEqualTo(PursuitWatch.Action.NONE);
    watch.reset();
    assertThat(watch.observe(id, at, now.plusSeconds(200), false))
        .isEqualTo(PursuitWatch.Action.NONE);
  }
}
