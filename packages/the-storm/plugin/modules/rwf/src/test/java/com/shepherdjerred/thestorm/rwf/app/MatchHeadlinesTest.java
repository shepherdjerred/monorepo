package com.shepherdjerred.thestorm.rwf.app;

import static com.shepherdjerred.thestorm.rwf.testing.Samples.ALICE;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOB;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.BOT_1;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.MATCH;
import static com.shepherdjerred.thestorm.rwf.testing.Samples.T0;
import static org.assertj.core.api.Assertions.assertThat;

import com.shepherdjerred.thestorm.rwf.app.MatchHeadlines.Headline;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot.CombatantView;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot.PhaseKind;
import com.shepherdjerred.thestorm.rwf.domain.match.Outcome;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

final class MatchHeadlinesTest {

  private final MatchHeadlines headlines = new MatchHeadlines();

  private static CombatantView fighter(CombatantId id, String name, TeamColor team) {
    return new CombatantView(id, name, Optional.of(team), Optional.empty(), true);
  }

  private static CombatantView waiting(CombatantId id, String name) {
    return new CombatantView(id, name, Optional.empty(), Optional.empty(), true);
  }

  private Optional<Headline> step(
      PhaseKind phase, Instant now, Optional<Outcome> outcome, CombatantView... combatants) {
    var snapshot =
        new MatchSnapshot(
            MATCH,
            phase,
            now,
            Optional.of("docks"),
            List.of(TeamColor.RED, TeamColor.BLUE),
            List.of(combatants),
            List.of(),
            Optional.empty(),
            outcome,
            Optional.empty());
    return headlines.accept(
        new MatchNotification(new MatchEvent.Tick(now, Map.of()), List.of(), snapshot));
  }

  @Test
  void announcesTheFirstHumanIntoAnEmptyLobbyOnce() {
    assertThat(step(PhaseKind.LOBBY, T0, Optional.empty(), waiting(BOT_1, "Rusher"))).isEmpty();
    assertThat(
            step(
                PhaseKind.LOBBY,
                T0,
                Optional.empty(),
                waiting(BOT_1, "Rusher"),
                waiting(ALICE, "Alice")))
        .contains(new Headline.LobbyOpened("Alice"));
    assertThat(
            step(
                PhaseKind.COUNTDOWN,
                T0,
                Optional.empty(),
                waiting(ALICE, "Alice"),
                waiting(BOB, "Bob")))
        .as("a second human joins an open lobby")
        .isEmpty();
  }

  @Test
  void announcesAWinWithTheHumanWinnersAndTheLiveTime() {
    var alice = fighter(ALICE, "Alice", TeamColor.RED);
    var bob = fighter(BOB, "Bob", TeamColor.BLUE);
    var bot = fighter(BOT_1, "Rusher", TeamColor.RED);
    step(PhaseKind.LOBBY, T0, Optional.empty(), alice, bob, bot);
    step(PhaseKind.LIVE, T0.plusSeconds(10), Optional.empty(), alice, bob, bot);

    var ended =
        step(
            PhaseKind.ENDED,
            T0.plusSeconds(735),
            Optional.of(new Outcome.Winner(TeamColor.RED)),
            alice,
            bob,
            bot);

    assertThat(ended)
        .contains(
            new Headline.Finished(
                "docks",
                Optional.of(TeamColor.RED),
                List.of("Alice"),
                List.of("Alice", "Bob"),
                Duration.ofSeconds(725)));
    assertThat(
            step(
                PhaseKind.ENDED,
                T0.plusSeconds(736),
                Optional.of(new Outcome.Winner(TeamColor.RED)),
                alice,
                bob))
        .as("announced once per match")
        .isEmpty();
  }

  @Test
  void announcesADrawWithoutWinners() {
    var alice = fighter(ALICE, "Alice", TeamColor.RED);
    step(PhaseKind.LOBBY, T0, Optional.empty(), alice);
    step(PhaseKind.LIVE, T0, Optional.empty(), alice);

    assertThat(step(PhaseKind.ENDED, T0.plusSeconds(42), Optional.of(new Outcome.Draw()), alice))
        .contains(
            new Headline.Finished(
                "docks", Optional.empty(), List.of(), List.of("Alice"), Duration.ofSeconds(42)));
  }

  @Test
  void staysQuietForStoppedAndBotsOnlyMatches() {
    var alice = fighter(ALICE, "Alice", TeamColor.RED);
    step(PhaseKind.LOBBY, T0, Optional.empty(), alice);
    step(PhaseKind.LIVE, T0, Optional.empty(), alice);
    assertThat(step(PhaseKind.ENDED, T0, Optional.of(new Outcome.Stopped()), alice)).isEmpty();

    var bot = fighter(BOT_1, "Rusher", TeamColor.BLUE);
    step(PhaseKind.RESETTING, T0, Optional.empty());
    assertThat(step(PhaseKind.LOBBY, T0, Optional.empty(), bot)).isEmpty();
    step(PhaseKind.LIVE, T0, Optional.empty(), bot);
    assertThat(
            step(
                PhaseKind.ENDED,
                T0.plusSeconds(60),
                Optional.of(new Outcome.Winner(TeamColor.BLUE)),
                bot))
        .as("a bots-only showcase")
        .isEmpty();
  }
}
