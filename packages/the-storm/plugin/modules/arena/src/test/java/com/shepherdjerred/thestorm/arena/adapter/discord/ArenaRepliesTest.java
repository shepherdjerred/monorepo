package com.shepherdjerred.thestorm.arena.adapter.discord;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.arena.app.store.LeaderboardStore.Standing;
import java.util.List;
import org.junit.jupiter.api.Test;

final class ArenaRepliesTest {

  @Test
  void listsOneArenasBestWaves() {
    assertThat(
            ArenaReplies.top(
                "Rustworks", List.of(new Standing("Alice_", 34), new Standing("Bob", 30))))
        .isEqualTo("**Rustworks** best waves:\n1. Alice\\_ — wave 34\n2. Bob — wave 30");
    assertThat(ArenaReplies.top("Rustworks", List.of()))
        .isEqualTo("Nobody has fought in **Rustworks** yet.");
  }

  @Test
  void listsEveryArenasRecord() {
    assertThat(
            ArenaReplies.bests(
                List.of(
                    new ArenaReplies.Best("Rustworks", List.of(new Standing("Alice", 34))),
                    new ArenaReplies.Best("Colosseum", List.of()))))
        .isEqualTo("Mob Arena records:\n**Rustworks**: Alice — wave 34\n**Colosseum**: nobody yet");
  }
}
