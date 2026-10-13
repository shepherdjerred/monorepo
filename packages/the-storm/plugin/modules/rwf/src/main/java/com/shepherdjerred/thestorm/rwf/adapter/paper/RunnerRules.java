package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.status.PublicGameDirectory;
import com.shepherdjerred.thestorm.rwf.app.PayoutService;
import com.shepherdjerred.thestorm.rwf.app.store.MatchStore;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.Phase;
import com.shepherdjerred.thestorm.rwf.domain.match.RwfMatch;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/** What {@link MatchRunner} reads off a match without touching the world. Pure. */
final class RunnerRules {

  private RunnerRules() {}

  /** Whether the phase, and every member's team and life, are the same in both. */
  static boolean sameRoster(RwfMatch before, RwfMatch after) {
    if (before.phase().getClass() != after.phase().getClass()
        || before.members().size() != after.members().size()) {
      return false;
    }
    for (var i = 0; i < before.members().size(); i++) {
      var was = before.members().get(i);
      var is = after.members().get(i);
      if (!was.id().equals(is.id()) || !was.team().equals(is.team()) || was.alive() != is.alive()) {
        return false;
      }
    }
    return true;
  }

  /** Whether {@code phase} is one a match reaches only by going live first. */
  static boolean reachedLive(Phase phase) {
    return phase instanceof Phase.Live || phase instanceof Phase.Ended;
  }

  /**
   * Whether {@code at} waits for bots: its map is loaded, and a lobby with {@code minHumans} humans
   * in it, a countdown or a preview runs.
   */
  static boolean draftable(RwfMatch at, int minHumans) {
    if (at.map().isEmpty()) {
      return false;
    }
    return switch (at.phase()) {
      case Phase.Lobby _ -> at.members().stream().filter(m -> !m.id().isBot()).count() >= minHumans;
      case Phase.Countdown _, Phase.Preview _ -> true;
      default -> false;
    };
  }

  /** Whether drafted bots may walk in now: the lobby, the countdown or the preview. */
  static boolean walksIn(Phase phase) {
    return phase instanceof Phase.Lobby
        || phase instanceof Phase.Countdown
        || phase instanceof Phase.Preview;
  }

  /**
   * How long drafted bots take to walk in: the first part of the countdown that is left, the time a
   * waiting lobby takes to relax its requirement, capped to fit a countdown that starts next, or no
   * time at all.
   */
  static Duration arrivalBudget(RwfMatch at, Instant now) {
    return switch (at.phase()) {
      // A map that loads in the last moment of the countdown, after it has run out but before the
      // next tick moves the match on, gets no time at all rather than a negative span.
      case Phase.Countdown countdown ->
          Duration.ofMillis(
              Math.max(
                  0,
                  Math.round(
                      Duration.between(now, countdown.startsAt()).toMillis()
                          * BotArrivals.ARRIVAL_SHARE)));
      case Phase.Lobby _ ->
          Duration.ofMillis(
              Math.min(
                  at.settings().relaxEvery().toMillis(),
                  Math.round(at.settings().countdown().toMillis() * BotArrivals.ARRIVAL_SHARE)));
      default -> Duration.ZERO;
    };
  }

  /** Whether members wait in the lobby in {@code phase}. */
  static boolean inLobby(Phase phase) {
    return phase instanceof Phase.Lobby
        || phase instanceof Phase.Countdown
        || phase instanceof Phase.Preparing
        || phase instanceof Phase.Resetting;
  }

  /** The match as the public game directory lists it, while humans are in it. */
  static Optional<PublicGameDirectory.Game> publicGame(MatchSnapshot snapshot) {
    var players =
        snapshot.combatants().stream()
            .filter(combatant -> !combatant.id().isBot())
            .map(combatant -> combatant.id().uuid())
            .toList();
    if (players.isEmpty()) {
      return Optional.empty();
    }
    var phase =
        switch (snapshot.phase()) {
          case LOBBY -> Optional.of(PublicGameDirectory.Phase.WAITING);
          case COUNTDOWN, PREPARING, PREVIEW, FREEZE ->
              Optional.of(PublicGameDirectory.Phase.STARTING);
          case LIVE -> Optional.of(PublicGameDirectory.Phase.RUNNING);
          case ENDED, RESETTING -> Optional.<PublicGameDirectory.Phase>empty();
        };
    return phase.map(
        listed ->
            new PublicGameDirectory.Game(
                snapshot.matchId().toString(),
                PublicGameDirectory.Kind.RWF,
                snapshot.mapId().orElse("Red Warfare"),
                listed,
                "",
                players));
  }

  /** The row's start: the live instant, or {@code endedAt} when the match never (quite) started. */
  static Instant startedAtFor(@Nullable Instant liveAt, Instant endedAt) {
    return liveAt == null || liveAt.isAfter(endedAt) ? endedAt : liveAt;
  }

  /** {@code member}'s row in match {@code matchId}'s record. */
  static MatchStore.PlayerRow playerRow(UUID matchId, Combatant member, boolean won, long credits) {
    return new MatchStore.PlayerRow(
        matchId,
        member.id().uuid(),
        member.team().orElseThrow(),
        member.kit().orElseThrow(),
        member.score().kills(),
        member.diedAt().isPresent() ? 1 : 0,
        MatchStore.Outcome.of(member.leftAt().isPresent(), member.forfeited(), won, credits),
        PayoutService.CURRENCY,
        credits,
        MatchStore.PayoutStatus.owing(credits),
        0);
  }
}
