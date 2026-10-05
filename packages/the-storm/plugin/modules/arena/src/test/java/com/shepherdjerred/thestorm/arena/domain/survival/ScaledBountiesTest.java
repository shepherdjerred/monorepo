package com.shepherdjerred.thestorm.arena.domain.survival;

import static com.shepherdjerred.thestorm.arena.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.arena.testing.Samples.BOB;
import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class ScaledBountiesTest {
  @Test
  void enlargedSoloAndTeamRoundsKeepOriginalIncomeAndIndependentContributionCounts() {
    for (var counts : new int[][] {{6, 9}, {15, 23}, {25, 38}, {160, 240}}) {
      var bounties = new ScaledBounties(counts[0], counts[1]);
      var emeralds = 0;
      var materials = 0;
      var experience = 0;
      for (var i = 0; i < counts[1]; i++) {
        var reward = bounties.next(ALICE);
        assertThat(bounties.next(BOB)).isEqualTo(reward);
        emeralds += reward.emeralds();
        materials += reward.materials();
        experience += reward.experience();
      }
      assertThat(emeralds).isEqualTo(counts[0] * 2);
      assertThat(materials).isEqualTo(counts[0]);
      assertThat(experience).isEqualTo(counts[0] * 2);
    }
  }
}
