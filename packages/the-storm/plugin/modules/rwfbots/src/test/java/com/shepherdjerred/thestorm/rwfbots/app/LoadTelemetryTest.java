package com.shepherdjerred.thestorm.rwfbots.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Archetype;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Quirk;
import com.shepherdjerred.thestorm.rwfbots.domain.personality.Style;
import com.shepherdjerred.thestorm.rwfbots.domain.team.Role;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Kit;
import com.shepherdjerred.thestorm.rwfbots.domain.world.MatchPhase;
import com.shepherdjerred.thestorm.rwfbots.domain.world.PoisonView;
import com.shepherdjerred.thestorm.rwfbots.domain.world.WorldSnapshot;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

final class LoadTelemetryTest {
  private static final CombatantId ID = new CombatantId(1);
  private static final BotProfile PROFILE =
      new BotProfile(
          ID,
          0,
          "test-bot",
          Fixtures.RED,
          Kit.TROOPER,
          Fixtures.levers(0.7),
          new Style(0.5, 0.5, 0.5, 0.5),
          Map.of(Role.HUNT, 1.0),
          Archetype.HUNTER,
          Set.of(Quirk.ALWAYS_GG));

  private static WorldSnapshot snapshot(long tick) {
    return new WorldSnapshot(
        tick,
        MatchPhase.LIVE,
        List.of(Fixtures.combatant(1, Fixtures.RED, Vec3.ZERO)),
        List.of(),
        PoisonView.NONE,
        "test-map",
        List.of(),
        List.of(),
        List.of());
  }

  @Test
  void unperceivedBotsAndTransientDelaysCannotDisappearBetweenPolls() {
    var stats = new LoadTelemetry();
    stats.reset(4);
    stats.record(snapshot(100), DecisionBoard.EMPTY, List.of(PROFILE), 0);
    stats.record(snapshot(112), DecisionBoard.EMPTY, List.of(PROFILE), 1);
    var fresh =
        new DecisionBoard(
            113, Map.of(), 0, 1, 0, 0, Map.of(), Map.of(ID, new PerceptionAge(113, false)));
    stats.record(snapshot(113), fresh, List.of(PROFILE), 0);
    var sample = stats.sample(5);
    assertThat(sample.observations()).isEqualTo(3);
    assertThat(sample.ageMax()).isEqualTo(12);
    assertThat(sample.pendingMax()).isEqualTo(1);
    assertThat(sample.governorMax()).isEqualTo(1);
    assertThat(sample.overruns()).isEqualTo(1);
    stats.reset(5);
    stats.record(snapshot(114), fresh, List.of(PROFILE), 0);
    assertThat(stats.sample(5).ageMax()).isEqualTo(1);
    assertThat(stats.sample(5).pendingMax()).isZero();
    assertThat(stats.sample(5).overruns()).isZero();
  }

  @Test
  void drainingKeepsJobsCompletedAfterTheCapturedBoundaryInTheNextInterval() {
    var stats = new LoadTelemetry();
    stats.reset(7);
    stats.record(snapshot(100), DecisionBoard.EMPTY, List.of(PROFILE), 0);
    assertThat(stats.drain(8).overruns()).isEqualTo(1);
    // The worker can complete a job while the main thread formats the drained sample.
    assertThat(stats.sample(9).overruns()).isEqualTo(1);
    assertThat(stats.sample(9).observations()).isZero();
  }

  @Test
  void firstObservationAgeStartsAtArrivalAndSurvivesAnIntervalReset() {
    var stats = new LoadTelemetry();
    stats.record(snapshot(100), DecisionBoard.EMPTY, List.of(), 0);
    stats.record(snapshot(120), DecisionBoard.EMPTY, List.of(PROFILE), 0);
    assertThat(stats.sample(0).ageMax()).isZero();
    stats.reset(0);
    stats.record(snapshot(125), DecisionBoard.EMPTY, List.of(PROFILE), 0);
    assertThat(stats.sample(0).ageMax()).isEqualTo(5);
  }

  @Test
  void futureObservationsCannotLookFresh() {
    assertThatThrownBy(() -> new PerceptionAge(10, false).at(9))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessageContaining("future");
  }

  @Test
  void aSingleSlowThinkJobSurvivesTheRecentDurationRing() {
    var stats = new ThinkStats();
    stats.record(50_000_001);
    for (var i = 0; i < 100; i++) stats.record(1_000);
    assertThat(stats.percentileMillis(0.95)).isLessThan(1);
    assertThat(stats.overruns()).isEqualTo(1);
    assertThat(stats.maximumMillis()).isGreaterThan(50);
  }
}
