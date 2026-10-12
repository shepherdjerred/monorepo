package com.shepherdjerred.thestorm.rwf.domain.lobby;

import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.core.result.Result;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchError;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSettings;
import com.shepherdjerred.thestorm.rwf.domain.match.RwfMatch;
import com.shepherdjerred.thestorm.rwf.testing.Samples;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import org.junit.jupiter.api.Test;

/** What the lobby shows: who is waiting, how many more the countdown needs and how long is left. */
final class LobbyStatusTest {

  /** Three players start a 90 s countdown; the requirement never relaxes within the test. */
  private static final MatchSettings SETTINGS =
      new MatchSettings(
          3,
          3,
          60,
          Duration.ofSeconds(90),
          Duration.ofHours(1),
          Duration.ofSeconds(15),
          Duration.ofMinutes(1));

  private RwfMatch match = RwfMatch.open(SETTINGS, Samples.MATCH, Samples.SEED);
  private Instant now = Samples.T0;

  private void on(MatchEvent event) {
    match =
        switch (match.on(event)) {
          case Result.Ok<RwfMatch.Step, MatchError>(var step) -> step.match();
          case Result.Err<RwfMatch.Step, MatchError>(var error) ->
              throw new AssertionError(event + " was refused: " + error);
        };
  }

  private void tick(Duration by) {
    now = now.plus(by);
    on(new MatchEvent.Tick(now, Map.of()));
  }

  @Test
  void anEmptyLobbyWaitsForPlayersWithNoMapYet() {
    var status = LobbyStatus.of(match, now);

    assertThat(status.stage()).isEqualTo(LobbyStatus.Stage.EMPTY);
    assertThat(status.map()).isEmpty();
    assertThat(status.needed()).isEqualTo(3);
    assertThat(status.progress()).isZero();
  }

  @Test
  void aLobbyShortOfPlayersSaysHowManyMoreItNeeds() {
    on(new MatchEvent.MapChosen(Samples.twoTeams()));
    on(new MatchEvent.Join(Samples.ALICE, "Alice", now));
    on(new MatchEvent.Join(Samples.BOT_1, "Rusher", now));
    tick(Duration.ofSeconds(1));

    var status = LobbyStatus.of(match, now);

    assertThat(status.stage()).isEqualTo(LobbyStatus.Stage.WAITING);
    assertThat(status.map()).contains("Harbour");
    assertThat(status.humans()).isEqualTo(1);
    assertThat(status.bots()).isEqualTo(1);
    assertThat(status.needed()).isEqualTo(1);
    assertThat(status.progress()).isEqualTo(2 / 3D);
  }

  @Test
  void theCountdownCountsWholeSecondsDownAndDrainsItsProgress() {
    on(new MatchEvent.MapChosen(Samples.twoTeams()));
    on(new MatchEvent.Join(Samples.ALICE, "Alice", now));
    on(new MatchEvent.Join(Samples.BOB, "Bob", now));
    on(new MatchEvent.Join(Samples.CAROL, "Carol", now));
    tick(Duration.ofSeconds(1));

    var start = LobbyStatus.of(match, now);
    assertThat(start.stage()).isEqualTo(LobbyStatus.Stage.COUNTDOWN);
    assertThat(start.secondsLeft()).isEqualTo(90);
    assertThat(start.progress()).isEqualTo(1);
    assertThat(start.needed()).isZero();

    var later = LobbyStatus.of(match, now.plusMillis(85_500));
    assertThat(later.secondsLeft()).isEqualTo(5);
    assertThat(later.progress()).isEqualTo(4_500 / 90_000D);

    tick(Duration.ofSeconds(90));
    assertThat(LobbyStatus.of(match, now).stage()).isEqualTo(LobbyStatus.Stage.LIVE);
  }
}
