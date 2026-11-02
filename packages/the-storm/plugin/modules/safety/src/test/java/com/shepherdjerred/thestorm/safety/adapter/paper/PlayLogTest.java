package com.shepherdjerred.thestorm.safety.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.safety.domain.CommandContent;
import org.junit.jupiter.api.Test;

/** Console lines keep auth commands redacted and name the world and block. */
final class PlayLogTest {

  @Test
  void anAuthCommandIsRedacted() {
    var text = CommandContent.parse("/login hunter2").text();

    assertThat(PlayLog.command("Steve", "frontier 10 64 -3", text, "attempt"))
        .isEqualTo("player-command Steve frontier 10 64 -3 /login [redacted] attempt");
  }

  @Test
  void aPositionLineAddsTheNickWhenItDiffers() {
    assertThat(PlayLog.position("Lincbuggy", "world 1 2 3", "kawaii"))
        .isEqualTo("player-where Lincbuggy world 1 2 3 nick=kawaii");
    assertThat(PlayLog.position("Lincbuggy", "world 1 2 3", "Lincbuggy"))
        .isEqualTo("player-where Lincbuggy world 1 2 3");
  }

  @Test
  void aTeleportLineNamesBothEnds() {
    assertThat(
            PlayLog.teleport(
                "starnith_",
                new PlayLog.Move("world 6 73 118", "frontier 12 63 1", "PLUGIN", false)))
        .isEqualTo(
            "player-teleport starnith_ world 6 73 118 -> frontier 12 63 1 cause=PLUGIN cancelled=false");
  }
}
