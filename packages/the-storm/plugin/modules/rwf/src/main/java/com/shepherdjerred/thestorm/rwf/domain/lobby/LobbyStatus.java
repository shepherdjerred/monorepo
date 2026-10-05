package com.shepherdjerred.thestorm.rwf.domain.lobby;

import com.shepherdjerred.thestorm.rwf.domain.map.MapDefinition;
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
    double progress) {

  /** Where the match is, as the lobby tells it. */
  public enum Stage {
    /** Nobody has joined. */
    EMPTY,
    /** Players are in, but too few to count down. */
    WAITING,
    /** Counting down to the start. */
    COUNTDOWN,
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
    var map = match.map().map(MapDefinition::name);
    var bots = (int) match.members().stream().filter(member -> member.id().isBot()).count();
    var humans = match.members().size() - bots;
    var settings = match.settings();
    return switch (match.phase()) {
      case Phase.Lobby lobby -> {
        var waited = lobby.waitingSince().map(since -> Duration.between(since, now));
        var required = settings.requiredPlayers(waited.orElse(Duration.ZERO));
        var present = match.members().size();
        yield new LobbyStatus(
            present == 0 ? Stage.EMPTY : Stage.WAITING,
            map,
            humans,
            bots,
            Math.max(0, required - present),
            0,
            Math.min(1, present / (double) required));
      }
      case Phase.Countdown countdown -> {
        var left = Duration.between(now, countdown.startsAt());
        var seconds = left.isNegative() ? 0 : (int) Math.ceil(left.toMillis() / 1000D);
        var total = settings.countdown().toMillis();
        var remaining = Math.clamp(left.toMillis(), 0, total);
        yield new LobbyStatus(
            Stage.COUNTDOWN, map, humans, bots, 0, seconds, remaining / (double) total);
      }
      case Phase.Live _ -> new LobbyStatus(Stage.LIVE, map, humans, bots, 0, 0, 1);
      case Phase.Ended _ -> new LobbyStatus(Stage.ENDED, map, humans, bots, 0, 0, 1);
      case Phase.Resetting _ -> new LobbyStatus(Stage.RESETTING, map, humans, bots, 0, 0, 0);
    };
  }
}
