package com.shepherdjerred.thestorm.rwfbots.domain.team;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class HungarianTest {

  @Test
  void findsTheOptimalAssignmentWhereGreedyWouldNot() {
    // Greedy by row takes (0, 0)=0.9 then (1, 1)=0.2 = 1.1; optimal is 0.8 + 0.85 = 1.65.
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
  void handlesNegativeProfits() {
    double[][] profit = {{-0.5, -0.1}, {-0.2, -0.9}};
    assertThat(Hungarian.maximize(profit)).containsExactly(1, 0);
  }
}
