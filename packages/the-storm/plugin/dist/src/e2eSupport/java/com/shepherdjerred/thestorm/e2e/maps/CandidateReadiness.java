package com.shepherdjerred.thestorm.e2e.maps;

import com.shepherdjerred.thestorm.rwf.domain.match.MatchSnapshot;
import java.util.Optional;

/** Observes candidate terrain completion without closing the ordinary lobby ballot. */
public final class CandidateReadiness {
  private CandidateReadiness() {}

  public static boolean ready(Optional<MatchSnapshot> current, String mapId) {
    return current
        .filter(match -> match.phase() == MatchSnapshot.PhaseKind.LOBBY)
        .filter(match -> match.combatants().isEmpty())
        .flatMap(MatchSnapshot::ballot)
        .filter(ballot -> !ballot.closed())
        .filter(ballot -> ballot.candidates().size() == 1)
        .filter(ballot -> ballot.candidates().getFirst().mapId().equals(mapId))
        .flatMap(ballot -> ballot.visits().flatMap(visits -> visits.readyAt()))
        .isPresent();
  }
}
