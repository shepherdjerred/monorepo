package com.shepherdjerred.thestorm.rwf.app;

import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.combatant.TeamColor;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.Outcome;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * Picks the transitions worth announcing outside the game from the {@link MatchEvents} stream: a
 * lobby a human opens, and a match humans finish. Bots never count, so a bots-only showcase is
 * never announced. Main thread only, like the stream it reads.
 */
public final class MatchHeadlines {

  private MatchSnapshot.PhaseKind phase = MatchSnapshot.PhaseKind.LOBBY;
  private int humans;
  private Optional<Instant> liveSince = Optional.empty();

  /** What, if anything, {@code notification} is worth announcing. */
  public Optional<Headline> accept(MatchNotification notification) {
    var after = notification.after();
    var present = humansIn(after);
    var headline = headline(after, present);
    if (phase != MatchSnapshot.PhaseKind.LIVE && after.phase() == MatchSnapshot.PhaseKind.LIVE) {
      liveSince = Optional.of(after.now());
    }
    phase = after.phase();
    humans = present.size();
    return headline;
  }

  private Optional<Headline> headline(
      MatchSnapshot after, List<MatchSnapshot.CombatantView> present) {
    if (humans == 0 && !present.isEmpty() && preGame(after.phase())) {
      return Optional.of(new Headline.LobbyOpened(present.getFirst().name()));
    }
    if (phase != MatchSnapshot.PhaseKind.ENDED && after.phase() == MatchSnapshot.PhaseKind.ENDED) {
      return finished(after, present);
    }
    return Optional.empty();
  }

  private Optional<Headline> finished(
      MatchSnapshot after, List<MatchSnapshot.CombatantView> present) {
    var started = liveSince;
    liveSince = Optional.empty();
    if (present.isEmpty() || started.isEmpty() || after.mapId().isEmpty()) {
      return Optional.empty();
    }
    var outcome = after.outcome().orElseThrow();
    if (outcome instanceof Outcome.Stopped) {
      return Optional.empty();
    }
    var winner = outcome.winner();
    var winners =
        present.stream()
            .filter(view -> winner.isPresent() && view.team().equals(winner))
            .map(MatchSnapshot.CombatantView::name)
            .toList();
    return Optional.of(
        new Headline.Finished(
            after.mapId().orElseThrow(),
            winner,
            winners,
            present.stream().map(MatchSnapshot.CombatantView::name).toList(),
            Duration.between(started.orElseThrow(), after.now()),
            present.stream().map(view -> view.id().uuid()).toList()));
  }

  /** What the match is doing, for a status line; empty when no human is in it. */
  public static Optional<String> activity(MatchSnapshot snapshot) {
    var humans = humansIn(snapshot).size();
    if (humans == 0) {
      return Optional.empty();
    }
    return switch (snapshot.phase()) {
      case LIVE -> Optional.of("S&D: " + humans + " playing");
      case LOBBY, COUNTDOWN -> Optional.of("S&D lobby: " + humans + " waiting");
      case ENDED, RESETTING -> Optional.empty();
    };
  }

  private static List<MatchSnapshot.CombatantView> humansIn(MatchSnapshot snapshot) {
    return snapshot.combatants().stream()
        .filter(view -> view.id() instanceof CombatantId.Human)
        .toList();
  }

  private static boolean preGame(MatchSnapshot.PhaseKind phase) {
    return phase == MatchSnapshot.PhaseKind.LOBBY || phase == MatchSnapshot.PhaseKind.COUNTDOWN;
  }

  /** Something worth announcing. */
  public sealed interface Headline {

    /**
     * A human joined an empty lobby.
     *
     * @param player who opened it
     */
    record LobbyOpened(String player) implements Headline {}

    /**
     * A match humans played to a winner or a draw. Stopped matches are not announced.
     *
     * @param mapId the map
     * @param winner the winning team; empty for a draw
     * @param winners the humans on the winning team
     * @param players every human in the match at the end
     * @param length how long it was live
     * @param humans every human in the match at the end
     */
    record Finished(
        String mapId,
        Optional<TeamColor> winner,
        List<String> winners,
        List<String> players,
        Duration length,
        List<UUID> humans)
        implements Headline {

      public Finished {
        winners = List.copyOf(winners);
        players = List.copyOf(players);
        humans = List.copyOf(humans);
      }
    }
  }
}
