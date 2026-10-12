package com.shepherdjerred.thestorm.rwf.adapter.paper;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.domain.lobby.LobbyStatus;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** The words the lobby shows: the match board and the boss bar. */
final class LobbyTextsTest {

  private static LobbyStatus status(LobbyStatus.Stage stage, int needed, int seconds) {
    return new LobbyStatus(stage, Optional.of("Training Yard"), 1, 7, needed, seconds, 0.5);
  }

  @Test
  void theBoardNamesTheMapWhoIsInAndWhatTheMatchIsDoing() {
    assertThat(LobbyDisplays.boardLines(status(LobbyStatus.Stage.COUNTDOWN, 0, 42)))
        .containsExactly(
            "Next match", "Map: Training Yard", "Players: 1   Bots: 7", "Starting in 42s");
    assertThat(LobbyDisplays.boardLines(status(LobbyStatus.Stage.WAITING, 1, 0)).getLast())
        .isEqualTo("Waiting for 1 more player");
    assertThat(LobbyDisplays.boardLines(status(LobbyStatus.Stage.WAITING, 3, 0)).getLast())
        .isEqualTo("Waiting for 3 more players");
    assertThat(LobbyDisplays.boardLines(status(LobbyStatus.Stage.LIVE, 0, 0)).getLast())
        .isEqualTo("Match in progress");
    assertThat(
            LobbyDisplays.boardLines(
                new LobbyStatus(LobbyStatus.Stage.EMPTY, Optional.empty(), 0, 0, 1, 0, 0)))
        .contains("Map: choosing", "Waiting for players");
  }

  @Test
  void theBossBarCountsDownInSeconds() {
    assertThat(LobbyHud.text(status(LobbyStatus.Stage.COUNTDOWN, 0, 1)))
        .isEqualTo("Match starts in 1 second");
    assertThat(LobbyHud.text(status(LobbyStatus.Stage.COUNTDOWN, 0, 30)))
        .isEqualTo("Match starts in 30 seconds");
    assertThat(LobbyHud.text(status(LobbyStatus.Stage.WAITING, 2, 0)))
        .isEqualTo("Waiting for 2 more players");
  }
}
