package com.shepherdjerred.thestorm.rwfbots.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.Percept;
import com.shepherdjerred.thestorm.rwfbots.domain.perception.PerceptionState;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Decision;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Hop;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Option;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Stance;
import com.shepherdjerred.thestorm.rwfbots.domain.world.Waypoint;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** Stale thoughts degrade: the path stays, the aim lock and ability go, a rethink is asked for. */
final class DecisionGateTest {

  private static final CombatantId BOT = new CombatantId(1);
  private static final CombatantId ENEMY = new CombatantId(2);
  private static final DecisionGate GATE = new DecisionGate(40);

  private static BotThought thought(long tick, int epoch) {
    var decision =
        new Decision(
            BOT,
            Option.ENGAGE,
            Optional.of(ENEMY),
            List.of(new Waypoint(new Vec3(1, 1, 1), Hop.WALK)),
            Stance.AGGRESSIVE,
            Optional.empty(),
            Optional.of(new Vec3(5, 1, 5)),
            Optional.of("rewind"),
            "engage",
            tick,
            epoch);
    return new BotThought(decision, new Percept(PerceptionState.EMPTY, List.of(), tick), epoch);
  }

  @Test
  void noThoughtMeansIdleAndARethink() {
    var verdict = GATE.judge(Optional.empty(), BOT, 3, 100);

    assertThat(verdict.stale()).isTrue();
    assertThat(verdict.decision()).isEqualTo(Decision.idle(BOT, 100, 3));
  }

  @Test
  void aFreshThoughtIsFollowedAsItStands() {
    var thought = thought(90, 2);

    var verdict = GATE.judge(Optional.of(thought), BOT, 2, 100);

    assertThat(verdict.stale()).isFalse();
    assertThat(verdict.decision()).isSameAs(thought.decision());
  }

  @Test
  void anOldLifeKeepsThePathButDropsTheTargetAndAbility() {
    var thought = thought(99, 1);

    var verdict = GATE.judge(Optional.of(thought), BOT, 2, 100);

    assertThat(verdict.stale()).isTrue();
    assertThat(verdict.decision().target()).isEmpty();
    assertThat(verdict.decision().ability()).isEmpty();
    assertThat(verdict.decision().waypoints()).isEqualTo(thought.decision().waypoints());
    assertThat(verdict.decision().watch()).isEqualTo(thought.decision().watch());
    assertThat(verdict.decision().option()).isEqualTo(Option.ENGAGE);
  }

  @Test
  void aDecisionOlderThanTheLimitDegradesTheSameWay() {
    var verdict = GATE.judge(Optional.of(thought(59, 2)), BOT, 2, 100);
    assertThat(verdict.stale()).isTrue();
    assertThat(verdict.decision().target()).isEmpty();

    assertThat(GATE.judge(Optional.of(thought(60, 2)), BOT, 2, 100).stale()).isFalse();
  }
}
