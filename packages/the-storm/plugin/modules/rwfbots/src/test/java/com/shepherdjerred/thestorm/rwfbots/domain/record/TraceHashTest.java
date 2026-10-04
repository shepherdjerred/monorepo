package com.shepherdjerred.thestorm.rwfbots.domain.record;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import java.util.List;
import org.junit.jupiter.api.Test;

final class TraceHashTest {

  private static DecisionTrace trace(double draw) {
    return new DecisionTrace(
        new CombatantId(3),
        120,
        List.of(new DecisionTrace.Feature("health", 14)),
        List.of(
            new DecisionTrace.ScoredOption(Option.ARM, 0.7),
            new DecisionTrace.ScoredOption(Option.HUNT, 0.2)),
        Option.ARM,
        0.3,
        draw);
  }

  @Test
  void equalTracesHashEqualAndDifferentOnesDiffer() {
    var a = TraceHash.EMPTY.add(trace(0.25)).add(trace(0.5));
    var b = TraceHash.EMPTY.add(trace(0.25)).add(trace(0.5));
    var c = TraceHash.EMPTY.add(trace(0.25)).add(trace(0.51));
    assertThat(a).isEqualTo(b);
    assertThat(a).isNotEqualTo(c);
    assertThat(a.hex()).hasSize(16);
  }
}
