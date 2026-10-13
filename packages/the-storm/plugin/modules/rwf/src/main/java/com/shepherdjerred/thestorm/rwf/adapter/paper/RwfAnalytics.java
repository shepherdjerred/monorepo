package com.shepherdjerred.thestorm.rwf.adapter.paper;

import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics;
import com.shepherdjerred.thestorm.core.analytics.ProductAnalytics.GameEvent;
import com.shepherdjerred.thestorm.rwf.app.MatchNotification;
import com.shepherdjerred.thestorm.rwf.domain.combatant.CombatantId;
import com.shepherdjerred.thestorm.rwf.domain.match.Combatant;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchEvent;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot.PhaseKind;
import com.shepherdjerred.thestorm.rwf.domain.match.Outcome;
import com.shepherdjerred.thestorm.rwf.domain.match.RwfMatch;
import java.time.Duration;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Stream;

/**
 * Search and Destroy's product events, for humans only: the kit each picks, each map vote, and how
 * each finished match went for them, plus the hooks the killstreak and kit shop call. Properties
 * are game facts (ids, counts, results), never names or chat. Main thread.
 */
final class RwfAnalytics {

  private final ProductAnalytics analytics;
  private PhaseKind phase = PhaseKind.LOBBY;
  private Optional<Instant> liveAt = Optional.empty();
  private Optional<MatchSnapshot> lastLive = Optional.empty();
  private List<Combatant> lastParticipants = List.of();

  RwfAnalytics(ProductAnalytics analytics) {
    this.analytics = analytics;
  }

  /** Hears every accepted step of the match. */
  void accept(MatchNotification notification, RwfMatch match) {
    var after = notification.after();
    switch (notification.event()) {
      case MatchEvent.PickKit pick when pick.id() instanceof CombatantId.Human human ->
          analytics.game(
              human.uuid(),
              GameEvent.RWF_KIT_SELECTED,
              Map.of("kit", pick.kitId(), "phase", name(after.phase())));
      case MatchEvent.Vote vote when vote.id() instanceof CombatantId.Human human ->
          analytics.game(
              human.uuid(),
              GameEvent.RWF_MAP_VOTE,
              Map.of(
                  "map",
                  vote.mapId(),
                  "candidates",
                  after.ballot().map(ballot -> ballot.candidates().size()).orElse(0)));
      default -> {}
    }
    observePhase(
        after, Stream.concat(match.members().stream(), match.departed().stream()).toList());
  }

  private void observePhase(MatchSnapshot after, List<Combatant> participants) {
    if (phase != PhaseKind.LIVE && after.phase() == PhaseKind.LIVE) {
      liveAt = Optional.of(after.now());
    }
    if (phase == PhaseKind.LIVE && after.phase() == PhaseKind.ENDED) {
      completed(after, participants, after.now(), after.outcome().orElseThrow());
    }
    if (phase == PhaseKind.LIVE && after.phase() == PhaseKind.RESETTING) {
      completed(lastLive.orElseThrow(), lastParticipants, after.now(), new Outcome.Stopped());
    }
    phase = after.phase();
    lastLive = after.phase() == PhaseKind.LIVE ? Optional.of(after) : Optional.empty();
    lastParticipants = after.phase() == PhaseKind.LIVE ? participants : List.of();
  }

  /** A human used a killstreak reward; the killstreaks call this. */
  void killstreakUsed(CombatantId id, String streak, int kills) {
    if (id instanceof CombatantId.Human human) {
      analytics.game(
          human.uuid(), GameEvent.RWF_KILLSTREAK_USED, Map.of("streak", streak, "kills", kills));
    }
  }

  /** A human bought a kit; the kit shop calls this. */
  void kitPurchased(CombatantId id, String kit, long price) {
    if (id instanceof CombatantId.Human human) {
      analytics.game(human.uuid(), GameEvent.RWF_KIT_PURCHASED, Map.of("kit", kit, "price", price));
    }
  }

  private void completed(
      MatchSnapshot after, List<Combatant> participants, Instant finishedAt, Outcome outcome) {
    var humans = participants.stream().filter(c -> !c.id().isBot()).count();
    var seconds = Duration.between(liveAt.orElseThrow(), finishedAt).toSeconds();
    for (var combatant : participants) {
      if (!(combatant.id() instanceof CombatantId.Human human)) {
        continue;
      }
      var properties = new HashMap<String, Object>();
      properties.put("map", after.mapId().orElse("unknown"));
      properties.put("result", result(outcome, combatant));
      properties.put("kills", combatant.score().kills());
      properties.put("assists", combatant.score().assists());
      properties.put("survived", combatant.alive());
      properties.put("kit", combatant.kit().orElse("none"));
      properties.put("humans", humans);
      properties.put("bots", participants.size() - humans);
      properties.put("duration_s", seconds);
      analytics.game(human.uuid(), GameEvent.RWF_MATCH_COMPLETED, properties);
    }
    liveAt = Optional.empty();
  }

  private static String result(Outcome outcome, Combatant combatant) {
    return switch (outcome) {
      case Outcome.Winner winner ->
          combatant.team().filter(winner.team()::equals).isPresent() ? "win" : "loss";
      case Outcome.Draw _ -> "draw";
      case Outcome.Stopped _ -> "stopped";
    };
  }

  private static String name(PhaseKind phase) {
    return phase.name().toLowerCase(Locale.ROOT);
  }
}
