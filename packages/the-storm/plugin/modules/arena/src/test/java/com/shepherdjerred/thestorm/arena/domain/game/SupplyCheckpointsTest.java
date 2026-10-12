package com.shepherdjerred.thestorm.arena.domain.game;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.arena.adapter.content.ContentFiles;
import com.shepherdjerred.thestorm.arena.testing.Samples;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

final class SupplyCheckpointsTest {
  @Test
  void clearedCheckpointsRestockOnceAndBossUpgradesDoNotDoubleGrant() {
    var content = ContentFiles.load(Path.of("../../../server/owned/plugins/TheStorm"));
    var play = new Play(Samples.setup(1, content.waves()), Samples.T0);
    play.start(Samples.ALICE, Samples.BOB);
    play.tick(5, 0);
    for (var wave = 1; wave <= 10; wave++) {
      var cleared = play.tick(1, 0);
      if (wave % 5 == 0) {
        assertThat(cleared).contains(new GameEffect.RestockChests());
      } else {
        assertThat(cleared).doesNotContain(new GameEffect.RestockChests());
      }
      if (wave == 5) {
        assertThat(cleared)
            .contains(
                new GameEffect.Upgrade(Samples.ALICE, "knight", 6),
                new GameEffect.Upgrade(Samples.BOB, "knight", 6));
        assertThat(play.tick(1, 0)).isEmpty();
        play.tick(4, 0);
      } else {
        var next = play.tick(5, 0);
        if (wave == 10) {
          assertThat(cleared.stream().filter(GameEffect.Upgrade.class::isInstance)).isEmpty();
          assertThat(next.stream().filter(GameEffect.Upgrade.class::isInstance)).hasSize(2);
        }
      }
    }
  }
}
