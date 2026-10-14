package com.shepherdjerred.thestorm.rwf.domain.lobby;

import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
import com.shepherdjerred.thestorm.rwf.domain.match.Ballot;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase;
import com.shepherdjerred.thestorm.rwf.domain.match.RwfMatch;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;

/**
 * What the lobby shows about the match at one instant: the boss bar, the match board and the
 * countdown titles all read from here.
 *
 * @param stage where the match is, as the lobby tells it
 * @param map the chosen map's display name
 * @param humans humans in the match
 * @param bots bots in the match
 * @param needed how many more players the countdown waits for; 0 once it runs
 * @param secondsLeft whole seconds until the match goes live, during the countdown; else 0
 * @param progress how far along the wait or the countdown is, 0 to 1
 */
public record LobbyStatus(
    Stage stage,
    Optional<String> map,
    int humans,
    int bots,
    int needed,
    int secondsLeft,
    double progress,
    Optional<String> botStatus) {

  public LobbyStatus withBotStatus(String status) {
    return new LobbyStatus(
        stage, map, humans, bots, needed, secondsLeft, progress, Optional.of(status));
  }

  /** Where the match is, as the lobby tells it. */
  public enum Stage {
    /** Nobody has joined. */
    EMPTY,
    /** Players are in, but too few to count down. */
    WAITING,
    /** Offered maps are being prepared serially for visits. */
    CANDIDATES,
    /** All offered maps are ready; independent visits and voting remain open. */
    VOTING,
    /** Counting down to the start. */
    COUNTDOWN,
    /** The chosen map is still loading. */
    PREPARING,
    /** Flying over the chosen map. */
    PREVIEW,
    /** Standing at the spawns, about to fight. */
    FREEZE,
    /** Being played. */
    LIVE,
    /** Showing the result. */
    ENDED,
    /** The map is being restored. */
    RESETTING
  }

  public LobbyStatus {
    if (humans < 0 || bots < 0 || needed < 0 || secondsLeft < 0) {
      throw new IllegalArgumentException("counts must not be negative");
    }
    if (!(progress >= 0 && progress <= 1)) {
      throw new IllegalArgumentException("progress must be between 0 and 1: " + progress);
    }
  }

  /** The status of {@code match} at {@code now}. */
  public static LobbyStatus of(RwfMatch match, Instant now) {
    var map =
        match
            .map()
            .map(MapDefinition::name)
            .or(() -> match.ballot().flatMap(LobbyStatus::proposed).map(Ballot.Candidate::name));
    var bots = (int) match.members().stream().filter(member -> member.id().isBot()).count();
    var humans = match.members().size() - bots;
    var picture = new Picture(map, humans, bots);
    return switch (match.phase()) {
      case Phase.Lobby lobby -> waiting(match, lobby, picture, now);
      case Phase.Countdown countdown -> countdown(match, countdown, picture, now);
      case Phase.Preparing _ -> picture.status(Stage.PREPARING, 0, 0, 1);
      case Phase.Preview preview ->
          picture.status(Stage.PREVIEW, 0, secondsUntil(now, preview.until()), 1);
      case Phase.Freeze freeze ->
          picture.status(Stage.FREEZE, 0, secondsUntil(now, freeze.until()), 1);
      case Phase.Live _ -> picture.status(Stage.LIVE, 0, 0, 1);
      case Phase.Ended _ -> picture.status(Stage.ENDED, 0, 0, 1);
      case Phase.Resetting _ -> picture.status(Stage.RESETTING, 0, 0, 0);
    };
  }

  private record Picture(Optional<String> map, int humans, int bots) {
    LobbyStatus status(Stage stage, int needed, int seconds, double progress) {
      return new LobbyStatus(stage, map, humans, bots, needed, seconds, progress, Optional.empty());
    }
  }

  private static LobbyStatus waiting(
      RwfMatch match, Phase.Lobby lobby, Picture picture, Instant now) {
    var window = lobby.ballot().visits().filter(_ -> !lobby.ballot().closed());
    if (window.isPresent()) {
      var visits = window.orElseThrow();
      var until = visits.until(lobby.waitingSince().orElse(now));
      if (until.isEmpty()) return picture.status(Stage.CANDIDATES, 0, 0, 0);
      if (now.isBefore(until.orElseThrow())) {
        var seconds = secondsUntil(now, until.orElseThrow());
        return picture.status(
            Stage.VOTING,
            0,
            seconds,
            Math.clamp(seconds / (double) visits.length().toSeconds(), 0, 1));
      }
    }
    var waited = lobby.waitingSince().map(since -> Duration.between(since, now));
    var required = match.settings().requiredPlayers(waited.orElse(Duration.ZERO));
    var present = match.members().size();
    return picture.status(
        present == 0 ? Stage.EMPTY : Stage.WAITING,
        Math.max(0, required - present),
        0,
        Math.min(1, present / (double) required));
  }

  private static LobbyStatus countdown(
      RwfMatch match, Phase.Countdown countdown, Picture picture, Instant now) {
    var left = Duration.between(now, countdown.startsAt());
    var total =
        countdown.ballot().visits().isPresent()
            ? match.settings().voteLead().toMillis()
            : match.settings().countdown().toMillis();
    var remaining = Math.clamp(left.toMillis(), 0, total);
    return picture.status(
        Stage.COUNTDOWN,
        0,
        secondsUntil(now, countdown.startsAt()),
        total == 0 ? 0 : remaining / (double) total);
  }

  private static int secondsUntil(Instant now, Instant until) {
    var left = Duration.between(now, until);
    return left.isNegative() ? 0 : (int) Math.ceil(left.toMillis() / 1000D);
  }

  /** The map the vote chose, or the only map on offer when there is nothing to vote on. */
  private static Optional<Ballot.Candidate> proposed(Ballot ballot) {
    var chosen = ballot.chosen().flatMap(ballot::candidate);
    if (chosen.isPresent() || ballot.candidates().size() != 1) {
      return chosen;
    }
    return Optional.of(ballot.candidates().getFirst());
  }
}
