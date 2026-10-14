package com.shepherdjerred.thestorm.rwf.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.app.view.Point;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;

final class TacticalFieldsTest {
  private static final Instant NOW = Instant.EPOCH;
  private static final UUID OWNER = UUID.fromString("00000000-0000-0000-0000-000000000001");
  private static final Point ORIGIN = new Point(0, 0, 0);

  @Test
  void smokeTestsTheFiniteSightSegmentIncludingInsideAndTangentEndpoints() {
    var smoke = new SmokeFields();
    smoke.add(new SmokeFields.Field(OWNER, ORIGIN, 4, NOW.plusSeconds(6)));
    assertThat(smoke.obscured(new Point(-10, 0, 0), new Point(10, 0, 0))).isTrue();
    assertThat(smoke.obscured(ORIGIN, ORIGIN)).isTrue();
    assertThat(smoke.obscured(new Point(-10, 4, 0), new Point(10, 4, 0))).isTrue();
    assertThat(smoke.obscured(new Point(-10, 4.001, 0), new Point(10, 4.001, 0))).isFalse();
    assertThat(smoke.obscured(new Point(5, 0, 0), new Point(10, 0, 0))).isFalse();
    smoke.expire(NOW.plusMillis(5999));
    assertThat(smoke.active()).isTrue();
    smoke.expire(NOW.plusSeconds(6));
    assertThat(smoke.obscured(ORIGIN, ORIGIN)).isFalse();
  }

  @Test
  void removingOneSmokeOwnerDoesNotClearAnotherAndResetClearsEveryField() {
    var smoke = new SmokeFields();
    smoke.add(new SmokeFields.Field(OWNER, ORIGIN, 4, NOW.plusSeconds(6)));
    var other = UUID.fromString("00000000-0000-0000-0000-000000000002");
    smoke.add(new SmokeFields.Field(other, new Point(100, 0, 0), 4, NOW.plusSeconds(6)));
    smoke.remove(OWNER);
    assertThat(smoke.obscured(ORIGIN, ORIGIN)).isFalse();
    assertThat(smoke.obscured(new Point(100, 0, 0), new Point(100, 0, 0))).isTrue();
    smoke.clear();
    assertThat(smoke.active()).isFalse();
  }

  private static BattleSounds.Cue sound(Point at, double radius, Instant time) {
    return new BattleSounds.Cue(
        1,
        new BattleSounds.Sound(OWNER, OWNER, at, BattleSounds.Kind.STEP, radius, Optional.empty()),
        time);
  }

  @Test
  void listeningPostNeedsAnActualInRangeCueAfterDeploymentAndRateLimitsReports() {
    var post = new ListeningPost(ORIGIN, NOW, NOW.plusSeconds(30), NOW);
    assertThat(post.hears(sound(new Point(12, 0, 0), 20, NOW), NOW)).isTrue();
    assertThat(post.hears(sound(new Point(12.001, 0, 0), 20, NOW), NOW)).isFalse();
    assertThat(post.hears(sound(new Point(6, 0, 0), 5, NOW), NOW)).isFalse();
    assertThat(post.hears(sound(ORIGIN, 5, NOW.minusMillis(1)), NOW)).isFalse();
    var reported = post.reported(NOW);
    assertThat(reported.hears(sound(ORIGIN, 5, NOW.plusMillis(2999)), NOW.plusMillis(2999)))
        .isFalse();
    assertThat(reported.hears(sound(ORIGIN, 5, NOW.plusSeconds(3)), NOW.plusSeconds(3))).isTrue();
    assertThat(reported.hears(sound(ORIGIN, 5, NOW.plusSeconds(30)), NOW.plusSeconds(30)))
        .isFalse();
    assertThat(ListeningPost.approximate(new Point(-0.1, 65, 10.1)))
        .isEqualTo(new Point(-2, 66, 10));
  }

  @Test
  void reportHistoryPreservesSameInstantSequenceAndBoundsAgeAndCapacity() {
    var time = new AtomicReference<>(NOW);
    var reports = new TacticalReportLog(time::get);
    var report = new TacticalReports.Report(OWNER, ORIGIN, 4);
    var first = reports.emit(report);
    var second = reports.emit(report);
    assertThat(reports.since(first.sequence())).containsExactly(second);
    for (var i = 0; i < TacticalReportLog.CAPACITY; i++) reports.emit(report);
    assertThat(reports.since(0)).hasSize(TacticalReportLog.CAPACITY).doesNotContain(first, second);
    time.set(NOW.plus(TacticalReportLog.RETENTION));
    assertThat(reports.since(0)).isEmpty();
  }

  @Test
  void aPostDoesNotReplayPreDeploymentSoundsFromTheSameInstant() {
    var post = new ListeningPost(ORIGIN, NOW, NOW.plusSeconds(30), NOW, 1);
    var before = sound(ORIGIN, 5, NOW);
    assertThat(post.hears(before, NOW)).isFalse();
    assertThat(post.hears(new BattleSounds.Cue(2, before.sound(), NOW), NOW)).isTrue();
  }
}
