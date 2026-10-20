package com.shepherdjerred.thestorm.arena.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

final class SnapshotsWithholdTest {

  @Test
  void rewardsStayPendingUntilThePlayerCanReceiveThem() {
    assertThat(Snapshots.withholdsReward(false, false, false, false)).isTrue();
    assertThat(Snapshots.withholdsReward(true, true, false, false)).isTrue();
    assertThat(Snapshots.withholdsReward(true, false, true, false)).isTrue();
    assertThat(Snapshots.withholdsReward(true, false, false, true)).isTrue();
    assertThat(Snapshots.withholdsReward(true, false, false, false)).isFalse();
  }
}
