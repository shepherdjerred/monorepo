package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static com.shepherdjerred.thestorm.rwfbots.domain.Fixtures.RED;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import java.util.List;
import java.util.SplittableRandom;
import org.junit.jupiter.api.Test;

final class BlackboardTest {

  private static SharedSighting report(long tick) {
    return new SharedSighting(
        new CombatantId(9), new Vec3(1, 0, 1), Vec3.ZERO, tick, tick, new CombatantId(1));
  }

  @Test
  void fullCoordinationSharesEverythingAtOnce() {
    var board =
        Blackboard.open(RED, Strategy.RUSH)
            .share(List.of(report(100)), 1.0, 100, new SplittableRandom(1));
    assertThat(board.visibleSightings(100)).hasSize(1);
  }

  @Test
  void poorCoordinationDelaysAndDropsSightings() {
    var random = new SplittableRandom(2);
    var shared = 0;
    for (var i = 0; i < 1000; i++) {
      var board = Blackboard.open(RED, Strategy.RUSH).share(List.of(report(100)), 0.0, 100, random);
      assertThat(board.visibleSightings(100)).isEmpty();
      if (!board.visibleSightings(100 + Blackboard.MAX_SHARE_DELAY_TICKS).isEmpty()) {
        shared++;
      }
    }
    assertThat(shared).isBetween(330, 470);
  }

  @Test
  void newerSightingsReplaceOlderOnes() {
    var random = new SplittableRandom(3);
    var board =
        Blackboard.open(RED, Strategy.RUSH)
            .share(List.of(report(100)), 1.0, 100, random)
            .share(List.of(report(120)), 1.0, 120, random)
            .share(List.of(report(90)), 1.0, 121, random);
    assertThat(board.sightingOf(new CombatantId(9), 121).orElseThrow().seenTick()).isEqualTo(120);
    assertThat(board.forget(new CombatantId(9)).sightings()).isEmpty();
  }
}
