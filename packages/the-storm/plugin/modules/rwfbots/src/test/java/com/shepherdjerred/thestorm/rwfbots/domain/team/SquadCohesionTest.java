package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.Fixtures;
import com.shepherdjerred.thestorm.rwfbots.domain.geom.Vec3;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantView;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class SquadCohesionTest {
  private static final Vec3 GOAL = new Vec3(20.5, 1, 5.5);

  private static TeamPlan previous() {
    var slots = List.of(slot("left"), slot("middle"), slot("right"));
    return new TeamPlan(
        Optional.of(Strategy.SPLIT),
        Optional.empty(),
        Optional.empty(),
        List.of(),
        0.5,
        slots,
        Map.of(
            new CombatantId(1), "left", new CombatantId(2), "middle", new CombatantId(3), "right"),
        0);
  }

  private static Slot slot(String key) {
    return new Slot(key, SlotKind.LANE, Role.ROTATE, GOAL, GOAL, -1, -1, Optional.empty(), 0);
  }

  private static CombatantView bot(int id, boolean arrived) {
    return Fixtures.combatant(id, Fixtures.RED, arrived ? GOAL : new Vec3(1.5, 1, 5.5));
  }

  @Test
  void theLineWaitsForTheSquadRatherThanAdvancingOnElapsedTimeAlone() {
    var plan = previous();
    assertThat(TeamBrain.push(plan, List.of(bot(1, false), bot(2, false), bot(3, true)), false))
        .isEqualTo(plan.push());
    assertThat(TeamBrain.push(plan, List.of(bot(1, true), bot(2, true), bot(3, false)), false))
        .isEqualTo(plan.push() + Playbook.ADVANCE);
  }

  @Test
  void contactAndDifferentFloorsDoNotCountAsAReadyAssaultLine() {
    var plan = previous();
    assertThat(TeamBrain.push(plan, List.of(bot(1, true), bot(2, true), bot(3, true)), true))
        .isEqualTo(plan.push());
    var above =
        List.of(bot(1, true), bot(2, true), bot(3, true)).stream()
            .map(bot -> bot.withPos(bot.pos().plus(0, 4, 0)))
            .toList();
    assertThat(TeamBrain.push(plan, above, false)).isEqualTo(plan.push());
    assertThat(TeamBrain.ERRATIC).isLessThan(TeamBrain.STICKY);
  }
}
