package com.shepherdjerred.thestorm.rwf.adapter.discord;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import org.junit.jupiter.api.Test;

final class RwfStatsCommandTest {

  @Test
  void summarisesACareer() {
    assertThat(RwfStatsCommand.text("Alice_", new MatchStore.Career(5, 3, 1, 12, 8)))
        .isEqualTo("**Alice\\_**: 5 matches, 3 wins, 1 losses · 12 kills, 8 deaths (K/D 1.50)");
    assertThat(RwfStatsCommand.text("Bob", new MatchStore.Career(1, 1, 0, 4, 0)))
        .endsWith("(K/D 4)");
    assertThat(RwfStatsCommand.text("Carol", new MatchStore.Career(0, 0, 0, 0, 0)))
        .isEqualTo("**Carol** has not played Search and Destroy yet.");
  }
}
