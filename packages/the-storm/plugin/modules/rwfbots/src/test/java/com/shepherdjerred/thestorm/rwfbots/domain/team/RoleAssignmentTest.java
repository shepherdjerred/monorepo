package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwfbots.domain.world.CombatantId;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

final class RoleAssignmentTest {

  @Test
  void hungarianFindsTheOptimalAssignmentWhereGreedyWouldNot() {
    // Greedy by row takes (0, PLANT)=0.9 then (1, ESCORT)=0.2 = 1.1; optimal is 0.8 + 0.85 = 1.65.
    double[][] profit = {{0.9, 0.8}, {0.85, 0.2}};
    assertThat(Hungarian.maximize(profit)).containsExactly(1, 0);
  }

  @Test
  void handlesRectangularAndLargerMatrices() {
    double[][] profit = {
      {1, 2, 3, 4},
      {2, 4, 6, 8},
      {3, 6, 9, 12}
    };
    var columns = Hungarian.maximize(profit);
    assertThat(columns).hasSize(3).doesNotHaveDuplicates();
    var total = 0.0;
    for (var i = 0; i < 3; i++) {
      total += profit[i][columns[i]];
    }
    // Distinct columns: row 2 takes 12, row 1 takes 6, row 0 is left with 2.
    assertThat(total).isEqualTo(12 + 6 + 2);
  }

  @Test
  void assignsEveryBotOneDistinctSlot() {
    var a = new CombatantId(1);
    var b = new CombatantId(2);
    var c = new CombatantId(3);
    var roles =
        RoleAssignment.assign(
            Map.of(
                a, Map.of(Role.PLANT, 0.9, Role.ESCORT, 0.8, Role.DEFEND, 0.1),
                b, Map.of(Role.PLANT, 0.85, Role.ESCORT, 0.2, Role.DEFEND, 0.1),
                c, Map.of(Role.PLANT, 0.1, Role.ESCORT, 0.1, Role.DEFEND, 0.9)),
            Strategy.SPLIT.slots(3));
    assertThat(roles)
        .containsEntry(a, Role.ESCORT)
        .containsEntry(b, Role.PLANT)
        .containsEntry(c, Role.DEFEND);
  }

  @Test
  void strategiesDealOnePlanterAndFillTheRest() {
    for (var strategy : Strategy.values()) {
      for (var size = 1; size <= 6; size++) {
        var slots = strategy.slots(size);
        assertThat(slots).hasSize(size);
        assertThat(slots.getFirst()).isEqualTo(Role.PLANT);
      }
    }
    assertThat(Strategy.RUSH.slots(4))
        .isEqualTo(List.of(Role.PLANT, Role.ESCORT, Role.ESCORT, Role.ESCORT));
  }
}
